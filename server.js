const redis = require('redis');
const client = redis.createClient();

const APPID = "wx91d91216bab95435";
const APPSECRET = "e38068f812b82ff2c7273d26722e34d8";

let accessToken = "";
let expireTime = 0;

client.on("error", (err) => {
  console.log("Redis error: ", err);
});

async function getAccessToken() {
  return new Promise((resolve, reject) => {
    client.get("accessToken", (err, result) => {
      if (err) return reject(err);
      if (result) {
        resolve(JSON.parse(result));
      } else {
        resolve(null);
      }
    });
  });
}

async function setAccessToken(token, expireIn) {
  client.set("accessToken", JSON.stringify({ token, expireIn }), "EX", expireIn - 60); // Set expiration time
}

async function fetchAccessToken() {
  const tokenRes = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${APPSECRET}`
  );
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    throw new Error("获取 access_token 失败");
  }
  const accessToken = tokenJson.access_token;
  const expireIn = tokenJson.expires_in * 1000;
  await setAccessToken(accessToken, expireIn);
  return accessToken;
}

app.all("/msgseccheck", async (req, res) => {
  try {
    const content = req.method === "POST" ? req.body.content : req.query.content;
    if (!content) {
      return res.status(400).json({ errcode: 40001, errmsg: "缺少content参数" });
    }

    const now = Date.now();
    if (!accessToken || now > expireTime) {
      const cachedToken = await getAccessToken();
      if (cachedToken && now < cachedToken.expireIn) {
        accessToken = cachedToken.token;
        expireTime = cachedToken.expireIn;
      } else {
        accessToken = await fetchAccessToken();
        expireTime = now + 3600 * 1000 - 60000; // Refresh before expiration
      }
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
