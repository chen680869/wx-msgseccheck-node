const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");

const APPID = "wx91d91216bab95435";
const APPSECRET = "e38068f812b82ff2c7273d26722e34d8";

let accessToken = "";
let expireTime = 0;

const app = express();
app.use(bodyParser.json());

/**
 * 获取微信的 access_token
 */
async function getAccessToken() {
  try {
    const tokenRes = await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${APPSECRET}`
    );
    const tokenJson = await tokenRes.json();

    if (tokenJson.access_token) {
      accessToken = tokenJson.access_token;
      expireTime = Date.now() + tokenJson.expires_in * 1000 - 60000; // 提前 1 分钟过期
      console.log("New access token:", accessToken);  // 打印新的 token
      console.log("Token Expiry Time:", expireTime);  // 打印新的过期时间
    } else {
      console.error("获取 access_token 失败:", tokenJson);
      // 打印错误信息，查看是否有 errcode 和 errmsg
      console.error("Error Details:", tokenJson);
    }
  } catch (e) {
    console.error("获取 access_token 出错:", e.message);
  }
}

/**
 * 检查 access_token 是否过期，如果过期则刷新
 */
async function checkAndRefreshToken() {
  const now = Date.now();
  // 如果 access_token 不存在或已过期，则获取新的 token
  if (!accessToken || now > expireTime) {
    console.log("Access token expired or not available, fetching a new one...");
    await getAccessToken();  // 获取新的 token
  }
}

/**
 * msg_sec_check 接口
 */
app.all("/msgseccheck", async (req, res) => {
  try {
    const content = req.method === "POST" ? req.body.content : req.query.content;
    if (!content) {
      return res.status(400).json({ errcode: 40001, errmsg: "缺少content参数" });
    }

    // 检查 access_token 是否过期，如果过期，则重新获取
    await checkAndRefreshToken();  // 检查并刷新 token

    // 调试：打印 access_token 和 expireTime
    console.log("Using Access Token:", accessToken);
    console.log("Token Expiry Time:", expireTime);

    // 调用微信 msg_sec_check 接口
    const checkRes = await fetch(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${accessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    const result = await checkRes.json();
    // 调试：打印接口返回的结果
    console.log("msg_sec_check response:", result);

    // 返回结果给客户端
    res.json(result);
  } catch (e) {
    console.error("服务器异常:", e.message);
    res.status(500).json({ errcode: -2, errmsg: "服务器异常", detail: e.message });
  }
});

// 启动服务
app.get("/", (req, res) => {
  res.send("微信 msgSecCheck 中转服务已启动");
});

// 监听端口
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
