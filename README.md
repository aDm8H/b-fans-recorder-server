# B站粉丝记录前后端服务器

##  b-fans-recorder-server

### 使用说明

#### 方式一：使用可执行文件exe（仅限Windows系统）

1. 在[release](https://github.com/aDm8H/b-fans-recorder-server/releases)处下载`b-fans-recorder-server.exe`主程序。
2. 启动`b-fans-recorder-server.exe`服务器，启动后将自动弹出前端网页。

#### 方式二：使用JavaScript源码运行

1. 请先安装好[NodeJs](https://nodejs.org/)环境。

2. 安装好相关依赖

   `npm install`

3. 运行主要脚本

   `node main.js`

> 推荐使用pm2自动运行脚本
>
> `npm install pm2 -g`
>
> `pm2 start main.js`



### 使用本地前端

默认情况下，前端页面从github.io加载，加载速度可能受限于网络。可前往下载[B站粉丝记录前端显示界面](https://github.com/aDm8H/b-fans-record-front/)，按照相关提示在电脑本地开启网页。

