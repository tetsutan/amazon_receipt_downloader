# amazon_receipt_downloader

# Install

```
npm install
```

# Usage

```
# first open real brower, then enter email and password to retrieve cookies. and re-run
node index.js
```

- 初回実行時にはbot検知を回避してcookieを取得するため、普通のブラウザが立ち上がります。
- ログインが完了したら一旦ブラウザが閉じるので、再度実行することで該当年の領収書をすべてダウンロードします。
- cookieの認証情報の期限が切れた場合、ログイン用のブラウザ立ち上げのため、再度実行が必要になります。
- 認証情報はcookie.txtにのみ保存されるので、不要になった場合はcookie.txtを削除してください。
