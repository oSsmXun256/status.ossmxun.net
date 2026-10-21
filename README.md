# status.ossmxun.net

ossmxun.net の稼働状況とメンテナンス案内。Astro + TypeScript + Tailwind CSSで生成する完全静的サイトです。

## 開発

Node.js 24で動作確認しています。

```sh
npm ci
npm run dev
npm run check
npm test
npm run build
```

`/` にサービスの稼働状態・稼働率・監視データ取得日時・障害履歴、`/maintenance` にメンテナンス案内を表示します。個々の監視実行日時はv3 List monitorsに含まれないため、取得日時と区別しています。

## 配信と更新

- Cloudflare PagesのGit連携。本番ブランチ`main`、ビルド`npm run build`、出力`dist`。
- Workers、Pages Functions、アダプター、データベースは使用しません。
- ページは公開リポジトリの`public/data/*.json`をGitHub Rawから取得します。GitHub Raw障害時は不明と表示します。
- UptimeRobot Freeの5分監視を使用。Actionsは毎時17分にv3 List monitorsを1回呼び、許可した項目だけをJSONに保存します。各サービスの稼働率は統計APIから1日1回取得し、6.5秒間隔で制限を守ります。初回実行はActions画面から手動実行します。
- APIキーはActions Secret `UPTIMEROBOT_API_KEY` に設定する読み取り専用キーです。Cloudflareやブラウザへ渡しません。
- 同期は本番用公開データの配信処理です。CIチェックは追加せず、検証はローカルで実施します。
- GitHub Actionsの予約実行には遅延・停止があり、厳密な1時間SLAはありません。公開リポジトリでは長期間活動がないと予約実行が無効になることがあります。Actions画面で再有効化してください。
- **Cloudflare PagesのBuild watch pathsで`public/data/*`を除外してください。** `[skip ci]`も併用します。時刻・状態・メンテナンスのJSON更新ではビルド不要です。UIやサービス定義を変更したときだけビルドします。
- 画面は5分ごとに再取得。取得失敗・APIエラー・3時間以上未更新は不明です。監視一時停止をメンテナンスと決めつけません。
- 稼働率はプロバイダーの統計APIが返す直近24時間の値を1日1回更新します。取得日時は稼働率にマウスを重ねると表示します。監視開始前の時間を独自に100%として補完しません。履歴は同期時に得られた障害を最大200件保持し、画面は直近50件を表示します。取得間隔内に完結し、APIの最新障害にも残らなかった障害は記録できません。
- API取得失敗は公開JSONに`fetchState: error`と不明状態を保存した後、Actionsも失敗にします。生の応答・原因文字列・ヘッダー・URL・APIキー・通知先は公開JSONに含めません。

## 監視対象の追加

1. UptimeRobotのブラウザ画面でHTTP監視を追加し、無料の5分間隔と転送追跡を設定します。
2. `src/data/services.json` の`monitorUrl`に同じURLを設定します。未設定は`null`とし、不明表示にします。
3. ローカルで型チェックとビルドを実行し、`feature`へpush後、公開承認された変更を`main`へ反映します。

CDNとdataは実在する`/lumaui/v2/manifest.json`を監視し、配信の応答を確認します。ルートは404が正常な構成です。Notify APIは`/health`と`/status`が404のため、公開ヘルスチェックURLの確認が必要です。ダッシュボードは公開入口の可用性のみを監視します。短縮URLは転送先の応答を監視し、転送先ドメインの一致までは検証しません。

## メンテナンス情報

`public/data/maintenance.json`を更新します。監視による障害と別のデータです。

```json
{
  "version": 1,
  "maintenance": [
    {
      "id": "unique-maintenance-id",
      "title": "配信基盤のメンテナンス",
      "serviceIds": ["cdn", "data"],
      "reason": "公開する作業理由",
      "status": "scheduled",
      "startsAt": "2026-11-01T01:00:00+09:00",
      "endsAt": null,
      "completedAt": null
    }
  ]
}
```

これは形式の例です。初期データに架空の予定は登録していません。状態は`scheduled`、`in_progress`、`completed`。時刻はタイムゾーン付きISO 8601、終了予定未定は`null`です。終了予定だけでは完了扱いにしません。作業完了時は`completed`と`completedAt`を設定します。

将来の管理画面はこのJSONを更新できます。管理用Worker・画面は未実装です。Redirect Rulesを作る際は対象ホストを明示し、`status.ossmxun.net`を必ず対象外にしてください。`/maintenance`は常時配信し、クエリ文字列から理由や対象を信頼して表示しません。StatusホストにAccess認証を追加しないでください。

## 無料枠

[UptimeRobot API](https://uptimerobot.com/api/)は全プランに含まれ、Freeは50監視・5分間隔。[API v3](https://uptimerobot.com/api/v3/)のFree制限は10リクエスト/分です。同期は通常1時間1リクエスト、統計取得日に監視数ぶんを追加します。[Cloudflare Pages](https://developers.cloudflare.com/pages/platform/limits/)のFreeは月500ビルドです。JSON更新の除外設定により、この同期はPagesのビルド枠を消費しません。通常閲覧は静的アセットのみです。
