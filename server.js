const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const port = 5000;

const uploadDir = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// 最大保存照片数量
const MAX_IMAGES_PER_PLANT = 5;

// 静态托管上传目录，方便远程查看，必须放这里，不能放在路由里
app.use('/uploads', express.static(uploadDir));

// 设置上传存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const plantId = req.body.plant_id || 'default';
    const plantDir = path.join(uploadDir, plantId);
    if (!fs.existsSync(plantDir)) fs.mkdirSync(plantDir, { recursive: true });

    // 清理多余旧文件
    const files = fs.readdirSync(plantDir)
      .filter(f => f.endsWith('.jpg'))
      .map(f => ({
        name: f,
        time: fs.statSync(path.join(plantDir, f)).mtime.getTime()
      }))
      .sort((a, b) => a.time - b.time); // 时间升序，最早文件在前

    while (files.length >= MAX_IMAGES_PER_PLANT) {
      const fileToDelete = files.shift();
      fs.unlinkSync(path.join(plantDir, fileToDelete.name));
      console.log(`已删除旧图片: ${fileToDelete.name}`);
    }

    cb(null, plantDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `${timestamp}.jpg`);
  }
});
const upload = multer({ storage });

// 记录最新上传时间，避免频繁推送
const lastAlertTimes = {};

// Server酱推送函数（替换 XXX 为你的 SCKEY）
async function sendServerChan(title, desp) {
  const url = `https://sctapi.ftqq.com/SCT228949TBTInaRthD0c0lTI37LSL2CYj.send`;
  try {
    const resp = await axios.get(url, { params: { title, desp } });
    console.log('Server酱返回:', resp.data);
  } catch (err) {
    console.error("推送失败:", err.message);
  }
}

// 缺水判断函数（图像颜色分析）
async function isPlantDry(imagePath) {
  try {
    const stats = await sharp(imagePath).stats();
    const green = stats.channels[1].mean;
    const brightness = stats.channels[0].mean + stats.channels[1].mean + stats.channels[2].mean;

    // 绿度低 + 亮度高，可能缺水
    return green < 80 && brightness > 400;
  } catch (err) {
    console.error("图像处理失败:", err);
    return false;
  }
}

// 上传接口
app.post('/upload', upload.single('image'), async (req, res) => {
  const plantId = req.body.plant_id || 'default';
  const soilHumidity = parseInt(req.body.soil_humidity) || null;
  const soilDry = req.body.soil_dry; // 获取土壤湿度状态
  const imgPath = req.file.path;
  console.log(`收到 ${plantId} 上传图片：${imgPath}, 土壤湿度：${soilHumidity}, 土壤湿度状态：${soilDry}`); // 打印土壤湿度状态

  const now = Date.now();

  // 判断是否缺水（优先用土壤湿度，无则用图像分析）
  let dry = false;
  if (soilHumidity !== null) {
    dry = soilHumidity < 40;  // 土壤湿度阈值可调
  } else {
    dry = await isPlantDry(imgPath);
  }

  // 无论是否缺水，先推送上传通知
  const urlPath = `/uploads/${plantId}/${path.basename(imgPath)}`;
  const title = `植物 ${plantId} 图片上传通知 🌱`;
  const desp = `🌿 图片已上传，土壤湿度：${soilHumidity !== null ? soilHumidity : '未知'}。\n[查看图片](https://cam.yj28.xyz${urlPath})`;
  await sendServerChan(title, desp);

  // 如果缺水，则发送缺水提醒
  if (dry) {
    lastAlertTimes[plantId] = now;
    const dryTitle = `植物 ${plantId} 缺水提醒 🌱`;
    const dryDesp = `🌿 可能缺水，请及时浇水。\n[查看图片](https://cam.yj28.xyz${urlPath})`;
    await sendServerChan(dryTitle, dryDesp);
    console.log(`已发送缺水提醒: ${dryTitle}`);
  } else {
    console.log(`植物 ${plantId} 状态正常`);
  }

  res.status(200).send("上传成功并处理完成");
});

// 手动上传接口
app.post('/upload_once', upload.single('image'), async (req, res) => {
  const plantId = req.query.plant_id || 'default';
  const soilHumidity = parseInt(req.query.soil_humidity) || null;
  const imgPath = req.file.path;
  console.log(`手动上传触发：植物 ${plantId} 上传图片：${imgPath}, 土壤湿度：${soilHumidity}`);

  const now = Date.now();

  let dry = false;
  if (soilHumidity !== null) {
    dry = soilHumidity < 40;
  } else {
    dry = await isPlantDry(imgPath);
  }

  // 打印土壤湿度状态
  console.log(`土壤湿度状态: ${dry ? '缺水' : '正常'}`);

  if (dry) {
    lastAlertTimes[plantId] = now;
    const dryTitle = `植物 ${plantId} 缺水提醒 🌱`;
    const dryDesp = `🌿 可能缺水，请及时浇水。\n[查看图片](https://cam.yj28.xyz/uploads/${plantId}/latest.jpg)`;
    await sendServerChan(dryTitle, dryDesp);
    console.log(`已发送缺水提醒: ${dryTitle}`);
  } else {
    console.log(`植物 ${plantId} 状态正常`);
  }

  // 返回上传后的图片信息
  res.json({
    status: 'success',
    message: '手动上传并检查成功!',
    imageUrl: `https://cam.yj28.xyz/uploads/${plantId}/latest.jpg`,
    dryStatus: dry ? '缺水' : '正常',
    soilHumidity: soilHumidity !== null ? soilHumidity : '未知',
    uploadTime: new Date(now).toLocaleString()
  });
});

// 定时任务示例（每天中午12点检查植物状态）
cron.schedule('0 12 * * *', async () => {
  console.log("执行每日植物状态检查任务");

  const plantIds = ['plant01'];  // 可扩展获取所有植物ID

  for (let plantId of plantIds) {
    // 获取植物图片路径
    const imagePath = path.join(uploadDir, plantId, 'latest.jpg');  // 示例文件路径

    // 判断植物是否缺水
    const dry = await isPlantDry(imagePath);  // 使用图像处理判断

    // 根据状态推送提醒
    const title = dry ? `植物 ${plantId} 缺水提醒 🌱` : `植物 ${plantId} 状态正常 🌱`;
    const desp = dry 
      ? `🌿 可能缺水，请及时浇水。\n[查看图片](https://cam.yj28.xyz/uploads/${plantId}/latest.jpg)`
      : `🌿 植物状态正常。\n[查看图片](https://cam.yj28.xyz/uploads/${plantId}/latest.jpg)`;

    await sendServerChan(title, desp);
  }
});

app.listen(port, () => {
  console.log(`🌱 植物监测服务器运行在 http://localhost:${port}`);
});
