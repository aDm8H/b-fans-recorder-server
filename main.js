const sqlite3 = require("sqlite3");
const child_process = require("child_process");
const WebSocket = require("ws");
const fs = require("fs");
const fetch = require("node-fetch");

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
const apiURI = "http://api.bilibili.com/x/relation/stat?vmid=";

//数据库初始化
var db;
db = new sqlite3.Database(`${GLOBAL_CONFIG.targetUID}.db`, function (e) {
    if (e) throw e;
    console.log("[数据库]成功打开db文件.");
});

db.run("CREATE TABLE fans(datetime INTEGER,fans INTEGER);", e => {
    if (e) {
        if (e.errno == 1) console.log("[数据库]数据表已创建过.");
        else throw e;
    } else {
        console.log("[数据库]成功建表.");
    }
});

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
        }

        if (req.type == "rt") {
            db.get("SELECT * FROM fans ORDER BY datetime DESC LIMIT 1", (err, dbResData) => {
                if (err) {
                    console.error("[数据库]读取最新数据时出错.");
                    return;
                }
                dbResArray = [dbResData.datetime, dbResData.fans];
                ws.send(JSON.stringify({ type: "rt", data: dbResArray }));
                console.debug("[WS]已发送最新一行数据.");
            });
        } else if (req.type == "all") {
            if (typeof req.sampling == "undefined" || !req.sampling) var sql = "SELECT * FROM fans ORDER BY datetime DESC";
            else var sql = "SELECT * FROM (SELECT * FROM(SELECT ROW_NUMBER() OVER (ORDER BY datetime DESC) AS rn, * from fans) ) WHERE rn%60=1";
            db.all(sql, (err, dbResData) => {
                if (err) {
                    console.error("[数据库]读取全部数据时出错. 降采样策略为: ", req.sampling);
                    return;
                }
                dbResArray = dbResData.map(row => [row.datetime, row.fans]);
                ws.send(JSON.stringify({ type: "all", data: dbResArray }));
                console.debug("[WS]已发送全部数据.降采样策略为: ", req.sampling);
            });
        } else if (req.type == "range") {
            var len = req.len;
            if (!len) len = 12;
            if (typeof req.sampling == "undefined" || !req.sampling) var sql = "SELECT * FROM fans ORDER BY datetime DESC LIMIT ?";
            else var sql = "SELECT * FROM (SELECT * FROM(SELECT ROW_NUMBER() OVER (ORDER BY datetime DESC) AS rn, * FROM fans) LIMIT ? ) WHERE rn%60=1";
            db.all(sql, len, (err, dbResData) => {
                if (err) {
                    console.error("[数据库]读取区间数据时出错. 区间长度为", len, "降采样策略为: ", req.sampling);
                    return;
                }
                dbResArray = dbResData.map(row => [row.datetime, row.fans]);
                ws.send(JSON.stringify({ type: "range", len: len, data: dbResArray }));
                console.debug("[WS]已发送区间数据. 长度为", len, "降采样策略为: ", req.sampling);
            });
        }
    });
});

console.log("[主程序]开始进行记录.");
recordOnce();
setInterval(recordOnce, GLOBAL_CONFIG.requestFansInterval);
function recordOnce() {
    var uri = apiURI + GLOBAL_CONFIG.targetUID;
    fetch(uri)
        .then(apiRes => {
            // console.debug(apiRes);
            if (apiRes.status != 200) {
                throw new Error("[Get-API]HTTP状态码异常", apiRes);
                return;
            }
            return apiRes.json();
        })
        .then(data => {
            var dt = new Date();
            var fans = data.data.follower;
            // console.log(moment(dt).format(), "实时粉丝数:", fans);
            db.run("INSERT INTO fans VALUES (?,?)", dt.getTime(), fans);
            return [dt.getTime(), fans];
        })
        .then(row => {
            //通过ws将最新数据发送
            server.clients.forEach(client => {
                client.send(JSON.stringify({ type: "rt", data: row }));
            });
        })
        .catch(e => {
            console.error(e);
        });
}

//打开浏览器

child_process.exec(`start https://adm8h.github.io/b-fans-record-front/?ws=ws://127.0.0.1:${GLOBAL_CONFIG.websocketServerPort}`);
