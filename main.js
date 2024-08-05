// Copyright © 2023 aDm8H
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

const Database = require("better-sqlite3");
const child_process = require("child_process");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const DEFAULT_CONFIG = {
    targetUID: "17603188",
    requestFansInterval: 5000,
    websocketServerPort: 12102,
};

var GLOBAL_CONFIG;
try {
    fs.accessSync("global-config.json", fs.constants.F_OK);
    GLOBAL_CONFIG = JSON.parse(fs.readFileSync("global-config.json", "utf-8"));
    console.log("[初始化]读取配置文件成功!");
} catch {
    console.warn("[初始化]配置文件global-config.json不存在!");
    console.log("[初始化]正在创建默认配置文件.");
    fs.writeFileSync("global-config.json", JSON.stringify(DEFAULT_CONFIG));
    GLOBAL_CONFIG = DEFAULT_CONFIG;
}
const B_FANS_API_PREFIX = "http://api.bilibili.com/x/relation/stat?vmid=";

//数据库初始化
try {
    var dbFilePath = path.join(process.cwd(), GLOBAL_CONFIG.targetUID + ".db");
    var db = new Database(dbFilePath);
    const initTableSQL = "CREATE TABLE IF NOT EXISTS fans(datetime INTEGER,fans INTEGER)";
    db.exec(initTableSQL);
} catch (err) {
    console.error("[数据库初始化]失败: ", err, "[程序退出]");
    process.exit(1);
}

//WebSocket服务器初始化
const WebSocketServer = WebSocket.Server;
const server = new WebSocketServer({
    port: GLOBAL_CONFIG.websocketServerPort,
});
server.on("open", () => {
    console.log("[WS]端口开启.");
});
server.on("error", err => {
    console.warn("[WS]连接出错.", err);
});
server.on("close", () => {
    console.log("[WS]连接关闭.");
});

server.on("connection", ws => {
    console.log("[WS]连接开启.");

    ws.on("message", msg => {
        reqStr = msg.toString();
        console.debug("[WS]新请求:", reqStr);
        try {
            req = JSON.parse(reqStr);
        } catch (error) {
            console.warn("[WS]请求的JSON解析失败.", error);
            return;
        }
        var reqVer = req.verion;
        if (typeof req.verion == "undefined" || reqVer == 1) {
            handleV1(req);
        }
    });

    function handleV1(req) {
        const rtStmt = db.prepare("SELECT * FROM fans ORDER BY datetime DESC LIMIT 1"),
            allDataStmtNoSampling = db.prepare("SELECT * FROM fans ORDER BY datetime DESC"),
            allDataStmtSampling = db.prepare(
                "SELECT * FROM (SELECT * FROM(SELECT ROW_NUMBER() OVER (ORDER BY datetime DESC) AS rn, * from fans) ) WHERE rn%60=1"
            ),
            rangeDataStmtNoSampling = db.prepare("SELECT * FROM fans ORDER BY datetime DESC LIMIT @range"),
            rangeDataStmtSampling = db.prepare(
                "SELECT * FROM (SELECT * FROM(SELECT ROW_NUMBER() OVER (ORDER BY datetime DESC) AS rn, * FROM fans) LIMIT @range ) WHERE rn%60=1"
            );

        if (req.type == "rt") {
            try {
                var dbResData = rtStmt.get();
            } catch (err) {
                console.error("[数据库]读取最新数据时出错.");
                return;
            }
            dbResArray = [dbResData.datetime, dbResData.fans];
            ws.send(JSON.stringify({ type: "rt", data: dbResArray }));
            console.debug("[WS]已发送最新一行数据.");
        } else if (req.type == "all") {
            var dbResData;
            try {
                if (typeof req.sampling == "undefined" || !req.sampling) dbResData = allDataStmtNoSampling.all();
                else dbResData = allDataStmtSampling.all();
            } catch (err) {
                console.error("[数据库]读取全部数据时出错. 降采样策略为: ", req.sampling);
                return;
            }

            dbResArray = dbResData.map(row => [row.datetime, row.fans]);
            ws.send(JSON.stringify({ type: "all", data: dbResArray }));
            console.debug("[WS]已发送全部数据.降采样策略为: ", req.sampling);
        } else if (req.type == "range") {
            var len = req.len;
            if (!len) len = 12;
            try {
                var dbResData;
                if (typeof req.sampling == "undefined" || !req.sampling) dbResData = rangeDataStmtNoSampling.all({ range: len });
                else {
                    dbResData = rangeDataStmtSampling.all({ range: len });
                }
            } catch (err) {
                console.error("[数据库]读取区间数据时出错. 区间长度为", len, "降采样策略为: ", req.sampling);
                return;
            }

            dbResArray = dbResData.map(row => [row.datetime, row.fans]);
            ws.send(JSON.stringify({ type: "range", len: len, data: dbResArray }));
            console.debug("[WS]已发送区间数据. 长度为", len, "降采样策略为: ", req.sampling);
        }
    }
});

console.log("[主进程]开始进行记录.");
recordOnce();
setTimeout(() => {
    recordOnce();
    setInterval(recordOnce, GLOBAL_CONFIG.requestFansInterval);
}, 5000 - (new Date().getTime() % 5000));
function recordOnce() {
    var uri = B_FANS_API_PREFIX + GLOBAL_CONFIG.targetUID;
    const recordStmt = db.prepare("INSERT INTO fans VALUES ( @time , @num )");
    fetch(uri)
        .then(apiRes => {
            // console.debug(apiRes);
            if (apiRes.status != 200) {
                throw new Error("[Get-API]HTTP状态码异常", apiRes);
            }
            return apiRes.json();
        })
        .then(data => {
            var dt = new Date();
            var fans = data.data.follower;
            // console.log(moment(dt).format(), "实时粉丝数:", fans);
            recordStmt.run({ time: dt.getTime(), num: fans });
            return [dt.getTime(), fans];
        })
        .then(row => {
            //通过ws将最新数据发送
            server.clients.forEach(client => {
                client.send(JSON.stringify({ type: "rt", data: row }));
            });
        })
        .catch(err => {
            console.warn("[Get-API]Fetch失败! ");
        });
}
//打开浏览器

child_process.exec(`start https://adm8h.github.io/b-fans-record-front/?ws=ws://127.0.0.1:${GLOBAL_CONFIG.websocketServerPort}`);
