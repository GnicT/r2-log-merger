````markdown
# R2 Log Merger

This project is designed to work alongside [`cloudflare-access-logger`](https://github.com/GnicT/cloudflare-access-logger). It pulls Cloudflare Worker access logs from an R2 bucket, merges them, and optionally sends a summary to Slack.

---

## 🚀 What It Does

- Fetches log files from an R2 bucket
- Merges and processes logs (e.g., by date or hostname)
- Pushes a daily summary to a specified Slack channel (optional)

---

## 📦 Requirements

- Node.js 18 or higher
- An R2 bucket containing log files written by `cloudflare-access-logger`
- A `.env` file (see below)

---

## ⚙️ Setup

1. Clone the repo

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the root folder with the following content:

   ```env
   R2_ACCESS_KEY_ID=[R2_ACCESS_KEY_ID]
   R2_SECRET_ACCESS_KEY=[R2_SECRET_ACCESS_KEY]
   R2_ENDPOINT=https://EXAMPLE.r2.cloudflarestorage.com
   R2_BUCKET=[R2_BUCKET_NAME]
   SLACK_WEBHOOK_URL=[SLACK_WEBHOOK]
   ```

   > Replace values in `[]` with your actual credentials and URLs.

4. Run the script:

   ```bash
   node merge.js
   ```

---

## 🧠 Related Projects

* [cloudflare-access-logger](https://github.com/GnicT/cloudflare-access-logger) – logs HTTP requests from your Cloudflare Workers to R2.

---

## 🛡️ Notes

* Make sure your R2 bucket permissions are correctly set to allow access from the script.

---

## 📄 License

MIT

````