const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");

const APPID = "wx91d91216bab95435";
const APPSECRET = "e38068f812b82ff2c7273d26722e34d8";

let accessToken = "";
let expireTime = 0;
let refreshing = false; // 用来标记是否正在刷新 Token

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
      console.log("New access token:", accessToken);
      console.log("Token Expiry Time:", expireTime);
    } else {
      console.error("获取 access_token 失败:", tokenJson);
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
  
  // 如果 token 不存在或过期，或者有其他请求正在刷新 token
  if (!accessToken || now > expireTime || refreshing) {
    if (!refreshing) {
      refreshing = true;  // 标记正在刷新
      console.log("Access token expired or not available, fetching a new one...");
      await getAccessToken();  // 获取新的 token
      refreshing = false;  // 刷新完成，标记刷新结束
    } else {
      console.log("Waiting for token refresh to complete...");
    }
  } else {
    console.log("Using cached access token...");
  }
}

/**
 * msg_sec_check 接口
 */
async function checkContentSecurity(content) {
  try {
    // 调用微信 msg_sec_check 接口
    const checkRes = await fetch(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${accessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    const result = await checkRes.json();
    // 如果返回的错误码表示 Token 已过期
    if (result.errcode === 40001) {
      console.log("Access token expired, refreshing...");
      // 过期时，刷新 Token 并重试
      await checkAndRefreshToken(); // 刷新 access_token
      return await checkContentSecurity(content); // 递归重试
    }

    // 正常返回结果
    return result;
  } catch (e) {
    console.error("服务器异常:", e.message);
    throw new Error("服务器异常");
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

    // 调用安全检查
    const result = await checkContentSecurity(content);

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
