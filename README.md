# 中国法律法规收集

本库收集和整理中国大陆法律法规供大家学习交流，每个文档均为 Markdown 格式。

- 最近更新时间：`2026-10-27 04:00`
- 条目数：`2491`
- 总字数：`10,608,762`

## 阅读

- **[使用目录开始阅读](laws/README.md)**
- **标题搜索**：进入[全库目录](TOC.md)后，按 Ctrl + F 进行搜索
- **全文搜索**：使用 [GitHub 搜索功能](https://github.com/search?q=repo%3AYuleBest%2Fchinese-laws+path%3A%2F%5Elaws%5C%2F%2F&type=code)进行搜索，可使用 `path:[目录路径]` 语法限制范围

## 你可能感兴趣

| [《宪法》](laws/宪法/zhrmghgxf-2018nxzwb-20180311.md) | [《民法典》](laws/法律/法律/民法商法/zhrmghgmfd-20200528.md) | [《刑法》](laws/法律/法律/刑法/zhrmghgxf-20201226.md) |
| :---: | :---: | :---: |
| [《刑事诉讼法》](laws/法律/法律/诉讼与非诉讼程序法/zhrmghgxsssf-20181026.md) | [《民事诉讼法》](laws/法律/法律/诉讼与非诉讼程序法/zhrmghgmsssf-20230901.md) | [《行政诉讼法》](laws/法律/法律/诉讼与非诉讼程序法/zhrmghgxzssf-20170627.md) |
| [《立法法》](laws/法律/法律/宪法相关法/zhrmghglff-20230313.md) | [《劳动合同法》](laws/法律/法律/社会法/zhrmghgldhtf-20121228.md) | [《行政处罚法》](laws/法律/法律/行政法/zhrmghgxzcff-20210122.md) |

## 开发

- Node ≥ 22、pnpm、pandoc
- LibreOffice、Chromium

```sh
pnpm install
pnpm build        # 拉列表 → 增量转换 → 重建映射 → 生成目录与索引
pnpm typecheck    # 改过脚本后先跑这个
```

各步也可单独执行：`pnpm get:laws-list`、`pnpm update:laws`、`pnpm build:mapping`、`pnpm build:toc`、`pnpm build:index`。

推送流程：`pnpm build` 确认产物无误 → `git add -A` → `git commit` → `git push origin main`。仓库没有 CI，产物直接提交，所以提交前在本地跑完整流水线。

## 数据源

- [国家法律法规数据库](https://flk.npc.gov.cn)

## 合规 / 许可

根据[《中华人民共和国著作权法》第五条](laws/法律/法律/民法商法/zhrmghgzzqf-20201111.md#L39-L46)，本作品的内容不适用于该法；如不受其他法律、法规保护，本作品内容在中国大陆和其他地区属于公有领域。
