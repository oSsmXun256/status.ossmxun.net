# status.ossmxun.net

Astro製の静的Statusページと、OCI VPS上のStatus APIです。

## 構成

- `https://status.ossmxun.net` — Cloudflare Pages。HTML/CSS/JSだけを配信します。
- `https://status-api.ossmxun.net` — OCI VPSのFastify API。Cloudflare Tunnel経由で公開します。
- UptimeRobot API v3から監視状態、24時間稼働率、障害履歴を取得し、APIプロセスのメモリに2分間キャッシュします。
- Cloudflare Workers、Pages Functions、DB、GitHub Actionsによる監視同期は使いません。
- APIキーはVPSのroot限定EnvironmentFileに設定します。公開JSON、ブラウザー、Gitには含めません。未設定時もAPIは起動し、稼働状態を`unknown`として返します。
- APIが取得失敗または5分を超過した場合は監視状態を不明として返します。計画メンテナンスは`/var/lib/status-api/maintenance.json`に分けて保存します。

## 開発・検証

```sh
npm ci
npm run check
npm run build
npm test
npm --prefix status-api ci
npm --prefix status-api run build
npm --prefix status-api test
```

## API

- `GET /api/status` — 公開用サービス状態、障害履歴、メンテナンス、データ鮮度。
- `GET /health` — APIプロセスとUptimeRobot接続状態。外部監視の失敗はプロセス状態と別に返します。
- CORSは`https://status.ossmxun.net`だけを許可します。公開GET APIのみを設け、管理APIはありません。
- APIは`127.0.0.1:3000`にbindし、Cloudflare Tunnelだけから到達させます。

## OCIへの初回導入

`status-api/deploy/status-api.service`をsystemdへ配置し、`status-api/deploy/maintenance.example.json`を`/var/lib/status-api/maintenance.json`へコピーします。環境変数は`/etc/status-api/status-api.env`に保存し、`root:root`・`0600`にします。`UPTIMEROBOT_API_KEY`にはUptimeRobotのRead-only keyを設定します。未設定時は状態を`unknown`で返します。

APIをビルド後、systemdを起動します。Cloudflare Tunnelは既存のローカル管理Tunnelを再利用し、`status-api.ossmxun.net`を`http://127.0.0.1:3000`へ向けます。外部公開ポートは追加しません。

## Pages

Cloudflare Pagesプロジェクト`status-ossmxun-net`のGit連携を維持します。ビルドコマンドは`npm run build`、出力先は`dist`です。静的アセットとして配信し、Workers/Functionsを追加しません。

## 監視対象

表示名、ホスト名、監視IDは`src/data/services.json`に定義します。監視先の追加・削除時はUptimeRobotとこの定義を合わせて変更してください。Discord Botの監視ホストはページに表示しません。
