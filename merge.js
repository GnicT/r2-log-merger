import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, paginateListObjectsV2 } from "@aws-sdk/client-s3";
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { pipeline } from "stream/promises";
import fetch from "node-fetch";

config({ path: process.env.ENV_PATH || '/root/r2-log-merger/.env' });

const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const ENDPOINT = process.env.R2_ENDPOINT;
const BUCKET = process.env.R2_BUCKET;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// console.log("🔧 ENV check:", {
//   R2_ACCESS_KEY_ID: !!ACCESS_KEY_ID,
//   R2_SECRET_ACCESS_KEY: !!SECRET_ACCESS_KEY,
//   R2_ENDPOINT: ENDPOINT,
//   R2_BUCKET: BUCKET,
//   SLACK: !!SLACK_WEBHOOK_URL,
// });

if (!ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !ENDPOINT || !BUCKET) {
  throw new Error("❌ Missing R2 config in .env file");
}

const s3 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
});

function getYesterdayDateStr() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function listHostnames(dateStr) {
  const prefix = `logs/`;
  const seen = new Set();
  const hostnames = [];
  let continuationToken;

  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });

    const result = await s3.send(command);
    for (const obj of result.Contents || []) {
      const parts = obj.Key.split("/");
      if (parts.length >= 3 && parts[2].startsWith(dateStr)) {
        const hostname = parts[1];
        if (!seen.has(hostname)) {
          seen.add(hostname);
          hostnames.push(hostname);
        }
      }
    }

    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return hostnames;
}

async function mergeLogsForHostname(hostname, dateStr) {
  const prefix = `logs/${hostname}/${dateStr}`;
  const paginator = paginateListObjectsV2(
    { client: s3 },
    { Bucket: BUCKET, Prefix: prefix }
  );

  const outputDir = path.join("merged", hostname);
  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `${dateStr}_merged.jsonl`;
  const outPath = path.join(outputDir, filename);
  const writeStream = fs.createWriteStream(outPath, { flags: "a" });

  let fileCount = 0;

  for await (const page of paginator) {
    for (const obj of page.Contents || []) {
      // console.log(`➡️ Fetching ${obj.Key}`);
      const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key });
      const response = await s3.send(getCmd);
      const body = await streamToString(response.Body);
      writeStream.write(body + "\n");
      fileCount++;
    }
  }

  writeStream.end();
  await new Promise((resolve) => writeStream.on("finish", resolve));

  if (fileCount === 0) {
    throw new Error(`No logs found for ${hostname}`);
  }

  // Gzip the merged file
  const gzipPath = outPath + ".gz";
  const source = fs.createReadStream(outPath);
  const destination = fs.createWriteStream(gzipPath);
  const gzip = zlib.createGzip();
  await pipeline(source, gzip, destination);

  // Upload gzipped file to R2
  const r2Key = `merged/${hostname}/${filename}.gz`;
  const gzippedBuffer = fs.readFileSync(gzipPath);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: r2Key,
    Body: gzippedBuffer,
    ContentType: "application/gzip",
  }));

  // Delete local files
  fs.unlinkSync(outPath);
  fs.unlinkSync(gzipPath);

  return r2Key;
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function sendToSlack(message) {
  if (!SLACK_WEBHOOK_URL) {
    console.warn("⚠️ No Slack webhook set");
    return;
  }

  console.log(`📣 Sending Slack message...`);
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });

  if (!res.ok) {
    console.error(`⚠️ Slack error: ${res.statusText}`);
  } else {
    console.log("✅ Slack message sent");
  }
}

async function main() {
  const dateStr = getYesterdayDateStr();
  console.log("📅 Merging logs for:", dateStr);

  const hostnames = await listHostnames(dateStr);
  console.log("🧭 Found hostnames:", hostnames);

  for (const hostname of hostnames) {
    try {
      const r2Key = await mergeLogsForHostname(hostname, dateStr);
      await sendToSlack(`✅ Merged logs for \`${hostname}\` — \`${dateStr}\`\n📦 Uploaded to \`r2://${r2Key}\``);
    } catch (err) {
      console.error(`❌ Failed to merge logs for ${hostname}:`, err.message);
      await sendToSlack(`❌ Failed to merge logs for \`${hostname}\`: ${err.message}`);
    }
  }
}

main();
