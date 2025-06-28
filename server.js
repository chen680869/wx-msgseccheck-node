const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");

const APPID = "wx91d91216bab95435";
const APPSECRET = "e38068f812b82ff2c7273d26722e34d8";

let accessToken = "";
let expireTime = 0;

const app = express();
app.use(bodyParser.json());

app.all("/msgseccheck", async (req, res) => {
  try {
    const content = req.method === "POST" ? req.body.content : req.query.content;
    if (!content) {
      return res.status(400).json({ errcode: 40001, errmsg: "缺少content参数" });
    }

    const now = Date.now();
    if (!accessToken || now > expireTime) {
      const tokenRes = await fetch(
        `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${APPSECRET}`
      );
      const tokenJson = await tokenRes.json();
      if (!tokenJson.access_token) {
        return res.status(500).json({ errcode: -1, errmsg: "获取 access_token 失败", detail: tokenJson });
      }
      accessToken = tokenJson.access_token;
      expireTime = now + tokenJson.expires_in * 1000 - 60000;
    }

    const checkRes = await fetch(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${accessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const result = await checkRes.json();
    res.json(result);
  } catch (e) {
    res.status(500).json({ errcode: -2, errmsg: "服务器异常", detail: e.message });
  }
});

app.get("/", (req, res) => {
  res.send("微信 msgSecCheck 中转服务已启动");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
