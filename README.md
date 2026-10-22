# status.ossmxun.net

Astro製の静的Statusページと、OCI VPS上のStatus APIです。

## 構成

- `https://status.ossmxun.net` — Cloudflare Pages。HTML/CSS/JSだけを配信します。
- `https://status-api.ossmxun.net` — OCI VPSのFastify API。Cloudflare Tunnel経由で公開します。
- UptimeRobot API v3から現在の監視状態と障害履歴、公式v2 `getMonitors`から24時間稼働率と日別稼働率を取得し、メモリに2分間キャッシュします。現在の12サービスでは1回の更新につき合計3リクエストです。
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

導入先はOCIのWebサーバーです。APIをビルド後、systemdを起動します。Cloudflare Tunnelは既存のローカル管理Tunnel `website-api` を再利用し、`status-api.ossmxun.net`を`http://127.0.0.1:3000`へ向けます。`status-api/deploy/add-tunnel-route.py`は既存経路を保持し、404 catch-allの前にルートを加えて検証し、元設定をバックアップします。外部公開ポートは追加しません。

Cloudflare DNSにはTunnel向けのプロキシ済みCNAMEを設定します。ゾーン全体のキャッシュルールより後に、`https://status-api.ossmxun.net/*`をキャッシュ対象外にするルールを置きます。

## Pages

Cloudflare Pagesプロジェクト`status-ossmxun-net`のGit連携を維持します。ビルドコマンドは`npm run build`、出力先は`dist`です。静的アセットとして配信し、Workers/Functionsを追加しません。

`public/_headers`のCSP `connect-src`でStatus APIのオリジンを許可します。APIのHTTP 200だけでは接続検証になりません。デプロイ後はブラウザで状態・日時・履歴の反映まで確認してください。

## 稼働率と日別履歴

v3の`lastDayUptimes.histogram`が空でも、公式v2の`custom_uptime_ratios=1`と`custom_uptime_ranges`で実測値を一括取得できます。キーはサーバー上のPOST本文にだけ含めます。統計取得に失敗した場合は稼働率とグラフを非表示にし、独立して取得できた現在の監視状態は表示します。

日別バーは日本時間の過去30日です。監視作成時刻より前の日と、監視を開始した不完全な日は`null`とし、APIが返す監視前の100%を公開しません。グレーは記録不足です。カテゴリの稼働率とバーは全メンバーの実測値が揃った場合のみ平均を表示します。DBや推定による履歴補完は行いません。

## 監視対象

表示名、ホスト名、監視IDは`src/data/services.json`に定義します。監視先の追加・削除時はUptimeRobotとこの定義を合わせて変更してください。Discord Botの監視ホストはページに表示しません。
