# 精选提示词

公开的精选提示词画廊。只展示已精选的提示词，可浏览、搜索、复制与下载，站点只读。

- 站点：https://shalom-lab.github.io/goodprompts/
- 仓库：https://github.com/shalom-lab/goodprompts

## 本地预览

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

Vite `base` 为 `/goodprompts/`，对应 GitHub Pages 项目站点路径。

## GitHub Pages

推送到 `main` 后，由 `.github/workflows/deploy-pages.yml` 构建并部署。仓库需设置为 **Settings → Pages → Build and deployment → Source: GitHub Actions**。

## 同步精选数据

`.github/workflows/sync-curated.yml` 每天（也可在 Actions 里手动运行）同步已精选的提示词和对应效果图，写入 `public/data/prompts.json` 与 `public/images/`，有变更时提交到 `main`。

请在本仓库 **Settings → Secrets and variables → Actions** 中添加：

| Secret 名称 | 说明 |
| --- | --- |
| `INFOFLOW_GITHUB_TOKEN` | 可读取私有 `shalom-lab/InfoFlow` 仓库的 GitHub PAT（Contents: Read） |

不要把 token 写进代码、`.env` 或提交记录。未配置该 secret 时，同步工作流会直接失败并提示补充。

本地若已有源仓库副本，也可手动同步并审计（不会把源仓库写入本仓库）：

```bash
python3 scripts/sync_curated.py --source /path/to/InfoFlow --dest .
python3 scripts/audit_public.py --source /path/to/InfoFlow --dest .
```
