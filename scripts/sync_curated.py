#!/usr/bin/env python3
"""Sync featured/starred prompts and their images into this public repo.

Reads only:
  <source>/data/prompt_featured.json
  <source>/data/data_all_prompts.json
  featured image files under <source>/infoflow-data/Images/Prompt/

Writes only:
  <dest>/public/data/prompts.json
  <dest>/public/images/prompt/<filename>

Does not copy WeChat drafts, unstarred prompts, tokens, or other private files.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

PUBLIC_FIELDS = (
    "prompt_id",
    "wechat_title",
    "content",
    "keywords",
    "image",
    "images",
    "image_count",
    "reply_keyword",
    "savedAt",
)

ALLOWED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def featured_ids(featured_doc: object) -> set[str]:
    if not isinstance(featured_doc, dict):
        raise SystemExit("prompt_featured.json 必须是对象")
    raw = featured_doc.get("featured", {})
    if not isinstance(raw, dict):
        raise SystemExit("prompt_featured.json 缺少 featured 映射")
    ids: set[str] = set()
    for key, value in raw.items():
        if value is True:
            ids.add(str(key))
    return ids


def resolve_source_image(source_root: Path, rel: str) -> Path | None:
    cleaned = rel.strip().replace("\\", "/").lstrip("./")
    if not cleaned:
        return None
    candidates: list[Path] = []
    if cleaned.startswith("../Images/"):
        candidates.append(source_root / "infoflow-data" / cleaned[3:])
    if cleaned.startswith("Images/"):
        candidates.append(source_root / "infoflow-data" / cleaned)
    if cleaned.startswith("infoflow-data/"):
        candidates.append(source_root / cleaned)
    if "/" not in cleaned:
        candidates.append(source_root / "infoflow-data" / "Images" / "Prompt" / cleaned)
    # Also try as a path relative to source root or Images/Prompt
    candidates.append(source_root / cleaned)
    candidates.append(source_root / "infoflow-data" / "Images" / "Prompt" / Path(cleaned).name)
    seen: set[Path] = set()
    for path in candidates:
        path = path.resolve()
        if path in seen:
            continue
        seen.add(path)
        if path.is_file():
            return path
    return None


def public_image_path(filename: str) -> str:
    return f"images/prompt/{filename}"


def publicize_rel(rel: str | None, copied_name: dict[str, str]) -> str | None:
    if not rel or not str(rel).strip():
        return None
    key = str(rel).strip()
    name = copied_name.get(key)
    if not name:
        # Fall back to basename if already copied under that filename
        name = Path(key).name
    return public_image_path(name)


def collect_image_refs(item: dict) -> list[str]:
    refs: list[str] = []
    seen: set[str] = set()

    def add(rel: object) -> None:
        if not isinstance(rel, str):
            return
        s = rel.strip()
        if not s or s in seen:
            return
        seen.add(s)
        refs.append(s)

    images = item.get("images")
    if isinstance(images, list) and images:
        for rel in images:
            add(rel)
    add(item.get("image"))
    return refs


def sanitize_item(item: dict, copied_name: dict[str, str]) -> dict:
    out: dict = {
        "prompt_id": str(item.get("prompt_id") or ""),
        "wechat_title": str(item.get("wechat_title") or ""),
        "content": str(item.get("content") or ""),
        "keywords": [str(k) for k in item.get("keywords", [])]
        if isinstance(item.get("keywords"), list)
        else [],
        "savedAt": str(item.get("savedAt") or ""),
    }
    if item.get("reply_keyword") is not None and str(item.get("reply_keyword")).strip():
        out["reply_keyword"] = str(item.get("reply_keyword")).strip()

    image_pub = publicize_rel(item.get("image") if isinstance(item.get("image"), str) else None, copied_name)
    images_src = item.get("images")
    images_pub: list[str] = []
    if isinstance(images_src, list):
        for rel in images_src:
            pub = publicize_rel(rel if isinstance(rel, str) else None, copied_name)
            if pub and pub not in images_pub:
                images_pub.append(pub)
    if image_pub:
        out["image"] = image_pub
    if images_pub:
        out["images"] = images_pub

    raw_count = item.get("image_count")
    count: int | None = None
    if isinstance(raw_count, (int, float)) and raw_count >= 0:
        count = int(raw_count)
    elif isinstance(raw_count, str) and raw_count.strip():
        try:
            n = float(raw_count)
            if n >= 0:
                count = int(n)
        except ValueError:
            count = None
    if count is not None:
        if images_pub:
            count = min(count, len(images_pub))
        out["image_count"] = count
    elif images_pub:
        out["image_count"] = len(images_pub)
    elif image_pub:
        out["image_count"] = 1

    # Keep field order stable
    ordered = {k: out[k] for k in PUBLIC_FIELDS if k in out}
    return ordered


def copy_featured_images(
    source_root: Path,
    dest_images: Path,
    items: list[dict],
) -> dict[str, str]:
    """Copy referenced images; return map of source rel path -> dest filename."""
    dest_images.mkdir(parents=True, exist_ok=True)
    wanted_files: set[str] = set()
    copied_name: dict[str, str] = {}
    missing: list[str] = []

    for item in items:
        for rel in collect_image_refs(item):
            src = resolve_source_image(source_root, rel)
            if src is None:
                missing.append(f"{item.get('prompt_id')}: {rel}")
                continue
            if src.suffix.lower() not in ALLOWED_IMAGE_SUFFIXES:
                missing.append(f"{item.get('prompt_id')}: unsupported image {rel}")
                continue
            filename = src.name
            dest = dest_images / filename
            shutil.copy2(src, dest)
            wanted_files.add(filename)
            copied_name[rel.strip()] = filename

    # Remove stale images that are no longer referenced by featured prompts.
    if dest_images.exists():
        for existing in dest_images.iterdir():
            if existing.is_file() and existing.name not in wanted_files:
                existing.unlink()

    if missing:
        print("警告：部分效果图未找到或未复制：", file=sys.stderr)
        for row in missing:
            print(f"  - {row}", file=sys.stderr)

    return copied_name


def load_json(path: Path) -> object:
    if not path.is_file():
        raise SystemExit(f"找不到必需文件：{path}")
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync featured prompts into the public repo")
    parser.add_argument("--source", required=True, help="Path to the private InfoFlow checkout")
    parser.add_argument("--dest", required=True, help="Path to the goodprompts repo root")
    args = parser.parse_args()

    source_root = Path(args.source).resolve()
    dest_root = Path(args.dest).resolve()
    if not source_root.is_dir():
        raise SystemExit(f"源目录不存在：{source_root}")
    if not dest_root.is_dir():
        raise SystemExit(f"目标目录不存在：{dest_root}")

    featured_path = source_root / "data" / "prompt_featured.json"
    prompts_path = source_root / "data" / "data_all_prompts.json"
    ids = featured_ids(load_json(featured_path))
    raw_prompts = load_json(prompts_path)
    if not isinstance(raw_prompts, list):
        raise SystemExit("data_all_prompts.json 必须是数组")

    by_id: dict[str, dict] = {}
    for item in raw_prompts:
        if not isinstance(item, dict):
            continue
        pid = item.get("prompt_id")
        if isinstance(pid, str) and pid:
            by_id[pid] = item

    missing_ids = sorted(ids - set(by_id))
    if missing_ids:
        print("警告：精选 id 在源提示词列表中不存在：", file=sys.stderr)
        for pid in missing_ids:
            print(f"  - {pid}", file=sys.stderr)

    featured_items = [by_id[pid] for pid in sorted(ids) if pid in by_id]

    dest_images = dest_root / "public" / "images" / "prompt"
    copied_name = copy_featured_images(source_root, dest_images, featured_items)

    public_items = [sanitize_item(item, copied_name) for item in featured_items]
    dest_json = dest_root / "public" / "data" / "prompts.json"
    dest_json.parent.mkdir(parents=True, exist_ok=True)
    dest_json.write_text(
        json.dumps(public_items, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        f"已写入 {len(public_items)} 条精选提示词 → {dest_json} "
        f"（源精选 true={len(ids)}，源条目={len(raw_prompts)}）"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
