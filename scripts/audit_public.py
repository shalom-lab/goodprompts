#!/usr/bin/env python3
"""Audit the public goodprompts tree before publish.

Fails if unpublished prompts, private WeChat/cloudbase files, tokens,
or unexpected fields would be shipped.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ALLOWED_FIELDS = {
    "prompt_id",
    "wechat_title",
    "content",
    "keywords",
    "image",
    "images",
    "image_count",
    "reply_keyword",
    "savedAt",
}

FORBIDDEN_FILENAMES = {
    "data_all_prompts.json",
    "prompt_featured.json",
    "cloudbase_prompts.json",
    "wechat_feature_drafts.json",
    "wechat_news_drafts.json",
    "wechat_newspic_drafts.json",
    "wechat_published.json",
    "wechat_sendall_columns.json",
}

FORBIDDEN_NAME_PATTERNS = (
    re.compile(r"^wechat_.*\.json$", re.I),
    re.compile(r"cloudbase", re.I),
    re.compile(r"^\.env($|\.)"),
)

# Token-like values. Do not flag the secret *name* INFOFLOW_GITHUB_TOKEN
# or GitHub Actions expressions like ${{ secrets.INFOFLOW_GITHUB_TOKEN }}.
TOKEN_PATTERNS = (
    re.compile(r"github_pat_[0-9A-Za-z_]{20,}"),
    re.compile(r"\bghp_[0-9A-Za-z]{20,}"),
    re.compile(r"\bgho_[0-9A-Za-z]{20,}"),
    re.compile(r"\bghu_[0-9A-Za-z]{20,}"),
    re.compile(r"\bghs_[0-9A-Za-z]{20,}"),
    re.compile(r"\bghr_[0-9A-Za-z]{20,}"),
    re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}"),
    re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{10,}"),
)

TEXT_SUFFIXES = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".yml",
    ".yaml",
    ".css",
    ".html",
    ".svg",
    ".txt",
    ".py",
    ".toml",
    ".gitignore",
}

SKIP_DIRS = {
    ".git",
    "node_modules",
    "dist",
    ".vite",
}


def featured_ids(featured_doc: object) -> set[str]:
    if not isinstance(featured_doc, dict):
        raise SystemExit("prompt_featured.json 必须是对象")
    raw = featured_doc.get("featured", {})
    if not isinstance(raw, dict):
        raise SystemExit("prompt_featured.json 缺少 featured 映射")
    return {str(k) for k, v in raw.items() if v is True}


def load_json(path: Path) -> object:
    if not path.is_file():
        raise SystemExit(f"找不到文件：{path}")
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def iter_repo_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        files.append(path)
    return files


def is_text(path: Path) -> bool:
    if path.name == ".gitignore" or path.name == ".nojekyll":
        return True
    if path.suffix.lower() in TEXT_SUFFIXES:
        return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit public goodprompts content")
    parser.add_argument("--source", required=True, help="Path to the private InfoFlow checkout")
    parser.add_argument("--dest", required=True, help="Path to the goodprompts repo root")
    args = parser.parse_args()

    source_root = Path(args.source).resolve()
    dest_root = Path(args.dest).resolve()
    errors: list[str] = []
    warnings: list[str] = []

    featured_path = source_root / "data" / "prompt_featured.json"
    source_prompts_path = source_root / "data" / "data_all_prompts.json"
    public_json = dest_root / "public" / "data" / "prompts.json"

    feat_true = featured_ids(load_json(featured_path))
    source_all = load_json(source_prompts_path)
    if not isinstance(source_all, list):
        errors.append("源 data_all_prompts.json 不是数组")
        source_all = []

    source_ids = {
        str(item.get("prompt_id"))
        for item in source_all
        if isinstance(item, dict) and item.get("prompt_id")
    }
    unstarred_ids = source_ids - feat_true

    public_items = load_json(public_json)
    if not isinstance(public_items, list):
        errors.append("public/data/prompts.json 不是数组")
        public_items = []

    published_ids: list[str] = []
    published_image_files: set[str] = set()
    for i, item in enumerate(public_items):
        if not isinstance(item, dict):
            errors.append(f"prompts.json[{i}] 不是对象")
            continue
        extra = set(item.keys()) - ALLOWED_FIELDS
        if extra:
            errors.append(f"prompts.json[{i}] 含未允许字段：{sorted(extra)}")
        pid = item.get("prompt_id")
        if not isinstance(pid, str) or not pid:
            errors.append(f"prompts.json[{i}] 缺少 prompt_id")
            continue
        published_ids.append(pid)
        if pid not in feat_true:
            errors.append(f"已发布 prompt_id 不在精选映射中：{pid}")
        for key in ("image",):
            rel = item.get(key)
            if isinstance(rel, str) and rel.strip():
                published_image_files.add(Path(rel).name)
        images = item.get("images")
        if isinstance(images, list):
            for rel in images:
                if isinstance(rel, str) and rel.strip():
                    published_image_files.add(Path(rel).name)

    published_set = set(published_ids)
    if len(published_ids) != len(published_set):
        errors.append("prompts.json 中存在重复 prompt_id")

    missing_published = sorted(feat_true & source_ids - published_set)
    if missing_published:
        errors.append(
            "源中已精选且存在条目，但未写入公开 JSON：" + ", ".join(missing_published)
        )

    featured_missing_source = sorted(feat_true - source_ids)
    if featured_missing_source:
        warnings.append(
            "精选 id 在源提示词列表中不存在：" + ", ".join(featured_missing_source)
        )

    files = iter_repo_files(dest_root)

    # Forbidden private filenames / WeChat dumps
    for path in files:
        name = path.name
        if name in FORBIDDEN_FILENAMES:
            errors.append(f"禁止出现的私有数据文件：{path.relative_to(dest_root)}")
            continue
        if any(p.search(name) for p in FORBIDDEN_NAME_PATTERNS):
            errors.append(f"禁止出现的文件名：{path.relative_to(dest_root)}")

    # Unstarred prompt ids must not appear in the public tree (text or filenames)
    # Sort longer ids first so we don't miss overlaps.
    unstarred_sorted = sorted(unstarred_ids, key=len, reverse=True)
    if unstarred_sorted:
        # Build one regex of literal ids
        ident_re = re.compile(
            "|".join(re.escape(pid) for pid in unstarred_sorted)
        )
        for path in files:
            rel = str(path.relative_to(dest_root))
            hay = rel
            if is_text(path):
                try:
                    hay += "\n" + path.read_text(encoding="utf-8", errors="replace")
                except OSError as e:
                    errors.append(f"无法读取 {rel}：{e}")
                    continue
            found = ident_re.findall(hay)
            if found:
                uniq = sorted(set(found))
                errors.append(
                    f"公开树中出现未精选 prompt_id（{rel}）：{', '.join(uniq)}"
                )

    # Token-like strings in text files
    for path in files:
        if not is_text(path):
            continue
        rel = str(path.relative_to(dest_root))
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            errors.append(f"无法读取 {rel}：{e}")
            continue
        for pat in TOKEN_PATTERNS:
            for m in pat.finditer(text):
                val = m.group(0)
                # Ignore Actions expressions / secret names
                if "INFOFLOW_GITHUB_TOKEN" in val:
                    continue
                errors.append(f"疑似密钥字符串（{rel}）：{val[:24]}…")

    # Images on disk must be referenced by published prompts
    images_dir = dest_root / "public" / "images" / "prompt"
    disk_images: set[str] = set()
    if images_dir.is_dir():
        for p in images_dir.iterdir():
            if p.is_file():
                disk_images.add(p.name)
    extra_images = sorted(disk_images - published_image_files)
    missing_images = sorted(published_image_files - disk_images)
    if extra_images:
        errors.append("public/images/prompt 中存在未被公开 JSON 引用的文件：" + ", ".join(extra_images))
    if missing_images:
        errors.append("公开 JSON 引用的效果图文件缺失：" + ", ".join(missing_images))

    # No vendored private tree
    if (dest_root / "infoflow-data").exists():
        errors.append("不应包含 infoflow-data/ 目录")
    if (dest_root / "InfoFlow").exists():
        errors.append("不应包含 InfoFlow/ 目录")

    print("=== 精选提示词公开仓库审计 ===")
    print(f"源精选 (true): {len(feat_true)}")
    print(f"源提示词总数: {len(source_ids)}")
    print(f"已写入公开 JSON: {len(published_ids)}")
    print(f"已复制效果图: {len(disk_images)}")
    print(f"未精选条目（不得出现）: {len(unstarred_ids)}")
    if warnings:
        print("警告：")
        for w in warnings:
            print(f"  - {w}")
    if errors:
        print("失败：")
        for e in errors:
            print(f"  - {e}")
        print("AUDIT: FAIL")
        return 1

    print("AUDIT: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
