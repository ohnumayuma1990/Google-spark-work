# GitHub Actions ワークフロー仕様書 (SPEC.md)

本ドキュメントは、本リポジトリで運用する GitHub Actions ワークフロー群の仕様および構成を定義します。

---

## 1. 概要

本リポジトリでは以下の 3 つの GitHub Actions ワークフローを運用します。

1. **CI Pipeline (`.github/workflows/ci.yml`)**
   コード変更時の静的解析 (lint)、ビルド、単体テストの自動実行を行います。
2. **Deploy to Cloud Run (`.github/workflows/deploy.yml`)**
   Workload Identity Federation (WIF) を利用し、Google Cloud Run へアプリケーションを安全に自動デプロイします。詳細な設定・実行手順は [デプロイ手順書 (DEPLOYMENT_GUIDE.md)](./DEPLOYMENT_GUIDE.md) を参照してください。
3. **Bulk Create Issues (`.github/workflows/create-issues.yml`)**
   `gh issue create` 形式のテキスト入力をパースし、複数の GitHub Issue を一括作成します。

---

## 2. ワークフロー詳細

### 2.1 CI Pipeline (`.github/workflows/ci.yml`)

* **目的**: 静的解析、ビルド、テストの自動化によるコード品質の担保
* **トリガー**:
  * `push`: ブランチ `main`, `master`, `jules-*`
  * `pull_request`: ブランチ `main`, `master`
* **動作環境**: `ubuntu-latest`
* **主要ステップ**:
  1. `actions/checkout@v4`: リポジトリのチェックアウト
  2. `actions/setup-node@v4`: Node.js 22.x のセットアップ
  3. `npm ci`: 依存パッケージのクリーンインストール（`package-lock.json` 存在時のみ実行）
  4. `npm run lint`: 静的解析の実行（`package-lock.json` 存在時のみ実行）
  5. `npm run build`: TypeScript 等のコンパイル実行（`package-lock.json` 存在時のみ実行）
  6. `npm test`: 単体テストの実行（`package-lock.json` 存在時のみ実行）

---

### 2.2 Deploy to Cloud Run (`.github/workflows/deploy.yml`)

* **目的**: Cloud Run への安全なコンテナ/アプリケーションの自動デプロイ
* **トリガー**:
  * `push`: ブランチ `main`
  * `workflow_dispatch`: 手動トリガー
* **権限設定 (permissions)**:
  * `contents: read`
  * `id-token: write`（WIF による OIDC トークン発行に必要）
* **動作環境**: `ubuntu-latest`
* **主要ステップ**:
  1. チェックアウトおよび Node.js 22.x のセットアップ（`package-lock.json` 存在時には `npm ci`, `npm test` による品質担保）
  2. `google-github-actions/auth@v2`: WIF による GCP 認証
     * Secrets 参照: `secrets.WORKLOAD_IDENTITY_PROVIDER`, `secrets.SERVICE_ACCOUNT`
  3. `google-github-actions/setup-gcloud@v2`: Cloud SDK のセットアップ
  4. `gcloud run deploy`: Cloud Run へのデプロイ実行
     * リージョン: `asia-northeast1` 等
     * オプション: 無料枠維持のため `--min-instances 0` を指定

---

### 2.3 Bulk Create Issues (`.github/workflows/create-issues.yml`)

* **目的**: `gh issue create` コマンド形式のテキスト入力を受け取り、複数 Issue を一括生成
* **トリガー**:
  * `workflow_dispatch`: 手動トリガー
    * 入力パラメータ `issues_text` (type: string, required: true, description: `gh issue create` 形式のコマンドテキスト)
* **権限設定 (permissions)**:
  * `issues: write`
  * `contents: read`
* **動作環境**: `ubuntu-latest`
* **主要ステップ**:
  1. `actions/checkout@v4`: リポジトリのチェックアウト
  2. `actions/setup-python@v5`: Python 3.x 実行環境の用意
  3. Python スクリプトの実行:
     * 環境変数 `INPUT_TEXT: ${{ inputs.issues_text }}` を受取
     * 正規表現または引数パースロジックで各 `gh issue create` 行/ブロックから `--title` (または `-t`) と `--body` (または `-b`) を抽出
     * 環境変数 `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` を用いて GitHub CLI (`gh issue create --title "..." --body "..."`) を順次実行
