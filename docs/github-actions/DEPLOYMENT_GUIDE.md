# Google Cloud (Cloud Run) デプロイ手順書

本ドキュメントでは、本リポジトリに含まれる GitHub Actions ワークフロー (`.github/workflows/deploy.yml`) を利用して、Google Cloud の Cloud Run へアプリケーションを自動デプロイする手順について解説します。

---

## 1. 概要

本リポジトリでは、GitHub Actions から Workload Identity Federation (WIF) を使用して Google Cloud に安全に認証し、Cloud Run (`app-service`) へアプリケーションを自動デプロイします。

サービスアカウントのキー（JSON）を長期保存・管理する必要がなく、セキュリティリスクを大幅に低減できます。

---

## 2. 事前準備 (Google Cloud 側の設定)

デプロイを実行する前に、Google Cloud コンソールまたは `gcloud` CLI で以下の設定を行います。

### 2.1 必要な API の有効化

以下の API を対象の GCP プロジェクトで有効化します。

```bash
gcloud services enable \
  iamcredentials.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com
```

### 2.2 デプロイ用サービスアカウントの作成と権限付与

Cloud Run デプロイ用のサービスアカウントを作成し、必要な権限（IAM ロール）を付与します。

```bash
# サービスアカウントの作成
gcloud iam service-accounts create gh-actions-deployer \
    --display-name="GitHub Actions Deployer"

# 必要なロールの付与
PROJECT_ID=$(gcloud config get-value project)

# Cloud Run 管理者権限
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:gh-actions-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/run.admin"

# サービス アカウント ユーザー権限（Cloud Run 実行用アカウントの指定に必要）
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:gh-actions-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"

# Storage 管理者権限 (Cloud Run `--source .` ビルド用 Artifact Registry / GCS)
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:gh-actions-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/storage.admin"

# Cloud Build 編集者権限
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:gh-actions-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/cloudbuild.builds.editor"
```

### 2.3 Workload Identity Federation (WIF) のセットアップ

GitHub Actions から GCP へのキーレス認証を実現するため、Workload Identity プールとプロバイダを作成します。

```bash
# 1. Workload Identity プールの作成
gcloud iam workload-identity-pools create "github-pool" \
    --location="global" \
    --display-name="GitHub Actions Pool"

# 2. プール ID の取得
WORKLOAD_IDENTITY_POOL_ID=$(gcloud iam workload-identity-pools describe "github-pool" \
    --location="global" \
    --format="value(name)")

# 3. Workload Identity プロバイダの作成
# YOUR_GITHUB_ORG/YOUR_REPO をご自身のリポジトリ情報（例: my-org/my-repo）に置き換えてください
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
    --location="global" \
    --workload-identity-pool="github-pool" \
    --display-name="GitHub Actions Provider" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
    --issuer-uri="https://token.actions.githubusercontent.com"

# 4. サービスアカウントとのバインド
# 対象の GitHub リポジトリからのアクセスのみ許可します
gcloud iam service-accounts add-iam-policy-binding "gh-actions-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/${WORKLOAD_IDENTITY_POOL_ID}/attribute.repository/YOUR_GITHUB_ORG/YOUR_REPO"
```

---

## 3. GitHub リポジトリ Secret の設定

作成した GCP リソースの情報を、GitHub リポジトリの Secret に登録します。

GitHub リポジトリの **[Settings] -> [Secrets and variables] -> [Actions]** を開き、以下の 2 つの Repository secrets を追加します。

| Secret 名 | 設定値の例・形式 | 説明 |
| :--- | :--- | :--- |
| `WORKLOAD_IDENTITY_PROVIDER` | `projects/123456789012/locations/global/workloadIdentityPools/github-pool/providers/github-provider` | Workload Identity プロバイダの完全リソース名 |
| `SERVICE_ACCOUNT` | `gh-actions-deployer@PROJECT_ID.iam.gserviceaccount.com` | 作成したデプロイ用サービスアカウントのメールアドレス |

---

## 4. ワークフロー構成解説 (`.github/workflows/deploy.yml`)

デプロイワークフローの主な処理内容は以下の通りです。

```yaml
name: Deploy to Cloud Run

on:
  push:
    branches:
      - main        # main ブランチへの Push 時に自動実行
  workflow_dispatch:  # GitHub Web 画面から手動実行可能

permissions:
  contents: read
  id-token: write     # WIF (OIDC) トークン生成に必須

jobs:
  deploy:
    name: Deploy Application
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22.x'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      # 1. Workload Identity を用いた認証
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.SERVICE_ACCOUNT }}

      # 2. Cloud SDK のセットアップ
      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      # 3. Cloud Run へのデプロイ実行
      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy app-service \
            --source . \
            --region asia-northeast1 \
            --allow-unauthenticated \
            --min-instances 0
```

---

## 5. デプロイの実行方法

### 5.1 自動デプロイ
1. ローカルで変更をコミットし、`main` ブランチへ Push または PR をマージします。
2. ワークフローが自動的にトリガーされ、ビルド・テスト・認証・デプロイが順次実行されます。

### 5.2 手動デプロイ (`workflow_dispatch`)
1. GitHub リポジトリの **[Actions]** タブを開きます。
2. 左サイドバーから **[Deploy to Cloud Run]** を選択します。
3. **[Run workflow]** ドロップダウンをクリックし、対象ブランチを選択して **[Run workflow]** を実行します。

---

## 6. 動作確認とトラブルシューティング

### 動作確認
* ワークフロー完了後、`Deploy to Cloud Run` ステップのログ末尾に表示される `Service URL: https://app-service-xxxxx-an.a.run.app` を確認し、ブラウザでアクセスします。

### トラブルシューティング
* **`Permission Denied` / 認証エラー**:
  * `WORKLOAD_IDENTITY_PROVIDER` または `SERVICE_ACCOUNT` の設定値に誤りがないか確認してください。
  * IAM ポリシーの `attribute.repository` に指定した GitHub リポジトリ名 (例: `org/repo`) が正しいか確認してください。
* **`npm test` 失敗による中断**:
  * デプロイ前にテストが実行されます。事前にローカル環境で `npm test` が成功することを確認してください。
