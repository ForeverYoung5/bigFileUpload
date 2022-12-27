const multiparty = require("multiparty");
const bodyParser = require("body-parser");
const express = require('express')
const path = require('path')
const fse = require("fs-extra")

let app = express()
const DirName = path.resolve(path.dirname(''));
const UPLOAD_FILES_DIR = path.resolve(DirName, "./filelist")
// 配置请求参数解析器
const jsonParser = bodyParser.json({ extended: false });
// 配置跨域
app.use(function (req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  next()
})
// 获取已上传的文件列表
const getUploadedChunkList = async (fileHash) => {
  const isExist = fse.existsSync(path.resolve(UPLOAD_FILES_DIR, fileHash))
  if (isExist) {
    return await fse.readdir(path.resolve(UPLOAD_FILES_DIR, fileHash))
  }
  return []
}

app.post('/verFileIsExist', jsonParser, async (req, res) => {
  const { fileHash, suffix } = req.body;
  const filePath = path.resolve(UPLOAD_FILES_DIR, fileHash + "." + suffix);
  if (fse.existsSync(filePath)) {
    res.send({
      code: 200,
      shouldUpload: false
    })
    return;
  }
  const list = await getUploadedChunkList(fileHash);
  if (list.length > 0) {
    res.send({
      code: 200,
      shouldUpload: true,
      uploadedChunkList: list
    })
    return;
  }
  res.send({
    code: 200,
    shouldUpload: true,
    uploadedChunkList: []
  })
})

app.post('/upload', async (req, res) => {
  // 营造一种接口响应很慢的假象
  setTimeout(() => {
    const multipart = new multiparty.Form();
    multipart.parse(req, async (err, fields, files) => {
      if (err) return;
      const [chunk] = files.chunk;
      const [hash] = fields.hash;
      const [suffix] = fields.suffix;
      // 注意这里的hash包含文件的hash和块的索引，所以需要使用split切分
      const chunksDir = path.resolve(UPLOAD_FILES_DIR, hash.split("-")[0]);
      if (!fse.existsSync(chunksDir)) {
        await fse.mkdirs(chunksDir);
      }
      await fse.move(chunk.path, chunksDir + "/" + hash);
    })
    res.status(200).send("received file chunk")
  }, 3000)
})

const pipeStream = (path, writeStream) =>
  new Promise(resolve => {
    const readStream = fse.createReadStream(path);
    readStream.on("end", () => {
      fse.unlinkSync(path);
      resolve();
    });
    readStream.pipe(writeStream);
  });

// 合并切片
const mergeFileChunk = async (filePath, fileHash, size) => {
  const chunksDir = path.resolve(UPLOAD_FILES_DIR, fileHash);
  const chunkPaths = await fse.readdir(chunksDir);
  chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1]);
  console.log("指定位置创建可写流", filePath);
  await Promise.all(
    chunkPaths.map((chunkPath, index) =>
      pipeStream(
        path.resolve(chunksDir, chunkPath),
        // 指定位置创建可写流
        fse.createWriteStream(filePath, {
          start: index * size,
          end: (index + 1) * size
        })
      )
    )
  );
  // 合并后删除保存切片的目录
  fse.rmdirSync(chunksDir);
};

app.post('/merge', jsonParser, async (req, res) => {
  const { fileHash, suffix, size } = req.body;
  const filePath = path.resolve(UPLOAD_FILES_DIR, fileHash + "." + suffix);
  await mergeFileChunk(filePath, fileHash, size);
  res.send({
    code: 200,
    message: "success"
  });
})

app.listen(3001, () => {
  console.log('listen:3001')
})
