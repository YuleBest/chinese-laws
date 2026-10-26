# 国家法律法规数据库 API 说明

## 目录

- [1. 概览](#1-概览)
- [2. 通用约定](#2-通用约定)
- [3. 接口总表](#3-接口总表)
- [4. 元数据与首页](#4-元数据与首页)
  - [4.1 分类 / 机关枚举](#41-分类--机关枚举)
  - [4.2 首页聚合数据](#42-首页聚合数据)
  - [4.3 搜索联想词](#43-搜索联想词)
- [5. 列表检索](#5-列表检索)
  - [5.1 普通检索 `search/list`](#51-普通检索-searchlist)
  - [5.2 命中高亮 `search/hitDisplay`](#52-命中高亮-searchhitdisplay)
  - [5.3 相关法规 `search/xgzl`](#53-相关法规-searchxgzl)
  - [5.4 高级检索 `highSearch/highSearch`](#54-高级检索-highsearchhighsearch)
  - [5.5 高级检索的命中 / 相关](#55-高级检索的命中--相关)
- [6. 法律详情](#6-法律详情)
  - [6.1 法规详情 `search/flfgDetails`](#61-法规详情-searchflfgdetails)
  - [6.2 修改/废止决定 `search/xgwjDetails`](#62-修改废止决定-searchxgwjdetails)
  - [6.3 相关文件详情 `search/xgzlDetails`](#63-相关文件详情-searchxgzldetails)
  - [6.4 关联推荐 `search/recommend`](#64-关联推荐-searchrecommend)
- [7. 下载与预览](#7-下载与预览)
  - [7.1 单文件下载 `download/pc`](#71-单文件下载-downloadpc)
  - [7.2 批量下载 `download/batch`](#72-批量下载-downloadbatch)
  - [7.3 在线预览 `amazonFile/previewLink`](#73-在线预览-amazonfilepreviewlink)
- [8. 纠错与杂项](#8-纠错与杂项)
- [9. 字段与编码附录](#9-字段与编码附录)
- [10. 踩坑与采集建议](#10-踩坑与采集建议)
- [11. 可直接运行的采集示例](#11-可直接运行的采集示例)
- [12. 拉取全站列表](#12-拉取全站列表)

---

## 1. 概览

| 项目 | 值 |
| --- | --- |
| 站点 | `https://flk.npc.gov.cn` |
| API 根 | `https://flk.npc.gov.cn/law-search/` |
| 协议 | HTTPS，全部为 HTTP/1.1 + JSON |
| 鉴权 | 无。无 token、无 cookie、无 referer 校验、无签名 |
| 请求体 | `application/json;charset=UTF-8`（POST），查询串（GET） |
| 响应体 | `{"code":200,"msg":"...","data":...}`，列表接口为 `{"total","rows",...}` |
| 前端路由 | `/index`、`/search`、`/advanceSearch`、`/detail`、`/error-correction` |
| WAF | 响应头带 `WZWS-RAY`（网站卫士），高频请求会被拦（返回 502 / `系统异常`） |

页面入口 `https://flk.npc.gov.cn/` 返回 552 字节的 Vite 壳，真实逻辑在：

```
/assets/index-BZ9XHUiV.js                 # 主 bundle，含全部 axios 封装
/assets/download-BupRsgCP.js              # 下载逻辑（docx/pdf、批量打 zip）
/assets/index-DvwoonSa.js                 # 检索页
/assets/index-Cq*.js 等                    # 各路由懒加载 chunk
```

---

## 2. 通用约定

### 2.1 状态码

**HTTP 状态码恒为 200**，业务状态看响应体里的 `code`：

```json
{ "code": 200, "msg": "操作成功", "data": {} }
{ "code": 500, "msg": "系统异常" }
{ "code": 500, "msg": "Required request parameter 'bbbs' for method parameter type String is not present" }
{ "code": 500, "msg": "参数异常" }
{ "code": 500, "msg": "验证码已过期，请点击验证码刷新" }
```

> `Required request parameter ...` 是 Spring 的参数缺失提示 —— 参数名写错时非常有用，可以据此推断真实字段名（例如详情接口是 `bbbs` 而不是 `id`）。

### 2.2 分页

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `pageNum` | number | 页码，从 1 开始 |
| `pageSize` | number | 每页条数，默认 20；实测 50 / 100 / 200 均可 |

### 2.3 排序 `orderByParam`

```json
{ "orderByParam": { "order": "gbrq", "sort": "ASC" } }
```

- `order`：排序字段名
- `sort`：`"ASC"` / `"DESC"`

**必须传对象**。传 `[]`（数组）会直接 `{"code":500,"msg":"系统异常"}` —— 这是用 curl 摸索时最常见的 500 原因。

实测可用值：

| UI 排序项 | `order` | `sort` |
| --- | --- | --- |
| 默认排序 | `-1` | `""` |
| 法律法规分类 | `flfg_code_id` | `ASC` |
| 制定机关 | `zdjg_code_id` | `ASC` |
| 时效性 | `sxx` | `DESC` |
| 公布日期 | `gbrq` | `ASC`（再点一次切 `DESC`） |
| 施行日期 | `sxrq` | `DESC` |

### 2.4 检索范围 / 匹配方式

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `searchRange` | `1` | 仅标题 |
| `searchRange` | `2` | 全文 |
| `searchType` | `1` | 精确 |
| `searchType` | `2` | 模糊 |

验证：`searchContent="违约金"`，`searchRange=1` 命中 1 条，`searchRange=2` 命中 340 条。

### 2.5 文本字段里的高亮标签

列表和输入框回显的 `title`、`contentHitDisplay` 里含 HTML：

```
中华人民共和国<em class='highlight'>民法典</em>
```

入库 / 展示前需清洗（正则 `/<[^>]+>/g`），或用配套的 `titleHightLightList` 结构自己拼。

---

## 3. 接口总表

| # | 方法 | 路径 | 用途 |
| --- | --- | --- | --- |
| 1 | GET | `/law-search/search/enumData` | 法规分类树 + 制定机关树 |
| 2 | GET | `/law-search/index/aggregateData` | 首页统计、新法速递、热搜、热下载、宪法 |
| 3 | GET | `/law-search/prompts/search?title=` | 搜索框联想词 |
| 4 | POST | `/law-search/search/list` | **列表 / 检索（核心）** |
| 5 | POST | `/law-search/search/hitDisplay` | 命中片段高亮 |
| 6 | POST | `/law-search/search/xgzl` | 相关法规 |
| 7 | POST | `/law-search/highSearch/highSearch` | 高级检索 |
| 8 | POST | `/law-search/highSearch/hitDisplay` | 高级检索命中高亮 |
| 9 | POST | `/law-search/highSearch/xgzl` | 高级检索相关法规 |
| 10 | GET | `/law-search/search/flfgDetails?bbbs=` | **法规详情（核心）** |
| 11 | GET | `/law-search/search/xgwjDetails?bbbs=` | 修改/废止决定的详情 |
| 12 | GET | `/law-search/search/xgzlDetails?bbbs=&fileId=` | 相关文件详情 |
| 13 | GET | `/law-search/search/recommend?bbbs=` | 关联推荐 |
| 14 | GET | `/law-search/download/pc?format=&bbbs=&fileId=` | **单文件下载（docx/pdf）** |
| 15 | POST | `/law-search/download/batch` | 批量下载（返回 URL 数组） |
| 16 | GET | `/law-search/amazonFile/previewLink?filePath=` | OFD 在线阅读链接 |
| 17 | GET | `/law-search/index/captchaImage` | 纠错验证码 |
| 18 | POST | `/law-search/index/fljc` | 提交纠错 |
| 19 | POST | `/law-search/file/upload` | 纠错图片上传 |
| 20 | GET | `/law-search/index/wjConfig` | 问卷配置（前端弹窗用） |

---

## 4. 元数据与首页

### 4.1 分类 / 机关枚举

```
GET https://flk.npc.gov.cn/law-search/search/enumData
```

无参数。响应 `data` 含三部分：

| 字段 | 说明 |
| --- | --- |
| `flfgfl` | 法律法规分类树（含 `codeId`，用于 `flfgCodeId` 筛选） |
| `zdjgfl` | 制定机关树（含 `codeId`，用于 `zdjgCodeId` 筛选，省级机关） |
| `flcaStatus` | 前端开关位 |

节点结构：

```json
{
  "id": 2,
  "parentId": 0,
  "name": "法律",
  "codeId": 101,
  "codeIdList": [101, 102, 110, 120, 130, 140, 150, 155, 160, 170, 180, 190, 195, 200],
  "level": 1,
  "children": [ ... ]
}
```

`codeIdList` 是「整个子树的所有 codeId」。**`flfgCodeId` 只按叶子编码精确匹配**：

- `flfgCodeId:[120]`（民法商法）→ 47 条
- `flfgCodeId:[101]` / `[102]`（"法律"父节点）→ **0 条**
- 想要"法律"整类，必须把 `codeIdList` 整个塞进去：`[101,102,110,120,130,140,150,155,160,170,180,190,195,200]` → 734 条（父节点 101/102 不命中但无副作用）

各叶子编码实测条数（全部时效性）：

| codeId | 分类 | 条数 |
| --- | --- | --- |
| 110 | 宪法相关法 | 78 |
| 120 | 民法商法 | 47 |
| 130 | 行政法 | 114 |
| 140 | 经济法 | 114 |
| 150 | 社会法 | 46 |
| 155 | 生态环境法 | 52 |
| 160 | 刑法 | 11 |
| 170 | 诉讼与非诉讼程序法 | 15 |
| 180 | 法律解释 | 27 |
| 190 | 有关法律问题和重大问题的决定（部分） | 188 |
| 195 | 修正案 | 12 |
| 200 | 修改、废止的决定 | 30 |

完整编码见 [附录 9.1](#91-法律法规分类-flfgfl) / [9.2](#92-制定机关-zdjgfl)。

### 4.2 首页聚合数据

```
GET https://flk.npc.gov.cn/law-search/index/aggregateData
```

实测响应（截断）：

```json
{
  "msg": "操作成功",
  "code": 200,
  "data": {
    "flflCount": [
      { "id": 1,  "key": "宪法",   "count": 1 },
      { "id": 2,  "key": "法律",   "count": 302 },
      { "id": 14, "key": "行政法规", "count": 605 },
      { "id": 15, "key": "监察法规", "count": 2 },
      { "id": 16, "key": "地方法规", "count": 15725 },
      { "id": 27, "key": "司法解释", "count": 562 }
    ],
    "xfsd": [ { "bbbs": "...", "title": "...", "gbrq": "2026-10-10", "score": 0, "flxz": "地方法规" } ],
    "popularSearch":   [ { "bbbs": "...", "title": "中华人民共和国民法典", "gbrq": "2020-05-28", "flxz": "法律" } ],
    "popularDownload": [ { "bbbs": "...", "title": "...", "gbrq": "...", "flxz": "..." } ],
    "xf": { "bbbs": "2c909fdd678bf17901678bf5a483004b", "title": "中华人民共和国宪法（2018年修正文本）" },
    "flcaStatus": 0
  }
}
```

| 字段 | 含义 |
| --- | --- |
| `flflCount` | 各分类法规总量（可用于总量核对） |
| `xfsd` | 新法速递（最新公布 5 条） |
| `popularSearch` | 热门检索 5 条 |
| `popularDownload` | 热门下载 5 条 |
| `xf` | 宪法正文条目 |

### 4.3 搜索联想词

```
GET https://flk.npc.gov.cn/law-search/prompts/search?title=民法典
```

参数名是 **`title`**（不是 `searchContent`），缺了会报 `Required request parameter 'title'`。

```json
{
  "code": 200,
  "msg": "操作成功",
  "data": [
    { "title": "民法典", "titleHighlight": "<em class='highlight'>民法典</em>" },
    { "title": "中华人民共和国民法典", "titleHighlight": "中华人民共和国<em class='highlight'>民法典</em>" }
  ]
}
```

---

## 5. 列表检索

### 5.1 普通检索 `search/list`

```
POST https://flk.npc.gov.cn/law-search/search/list
Content-Type: application/json
```

**完整请求体（浏览器抓包原文）**：

```json
{
  "searchRange": 1,
  "sxrq": [],
  "gbrq": [],
  "sxx": [],
  "searchType": 2,
  "xgzlSearch": false,
  "searchContent": "民法典",
  "orderByParam": { "order": "-1", "sort": "" },
  "flfgCodeId": [],
  "zdjgCodeId": [],
  "gbrqYear": [],
  "pageNum": 1,
  "pageSize": 20
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `searchContent` | string | 是 | 关键词，空串表示不按词检索（纯筛选） |
| `searchType` | number | 是 | 1 精确 / 2 模糊 |
| `searchRange` | number | 是 | 1 标题 / 2 全文 |
| `xgzlSearch` | boolean | 否 | 前端开关（疑为"是否连同相关资料检索"）。实测对 `total` 无影响，固定 `false` 即可 |
| `orderByParam` | object | 是 | 排序，见 [2.3](#23-排序-orderbyparam)，**不能传数组** |
| `flfgCodeId` | number[] | 否 | 法规分类编码，见附录 9.1。**只认叶子 codeId**，父节点（101/102/221/311）返回 0 条 |
| `zdjgCodeId` | number[] | 否 | 制定机关编码，见附录 9.2 |
| `sxx` | number[] | 否 | 时效性：1 已废止 / 2 已修改 / 3 有效 / 4 尚未生效 |
| `gbrqYear` | number[] | 否 | 公布年份，如 `[2020]` |
| `gbrq` | string[] | 否 | 公布日期区间 `["2020-01-01","2020-12-31"]` |
| `sxrq` | string[] | 否 | 施行日期区间，同上格式 |
| `pageNum` / `pageSize` | number | 是 | 分页 |

> `gbrq` / `sxrq` **只接受「两个日期字符串」的数组**；传 `[{"start":..,"end":..}]` 会 500。

**实测响应**：

```json
{
  "total": 894,
  "rows": [
    {
      "bbbs": "ff808081729d1efe01729d50b5c500bf",
      "title": "中华人民共和国<em class='highlight'>民法典</em>",
      "gbrq": "2020-05-28",
      "sxrq": "2021-01-01",
      "sxx": 3,
      "zdjgName": "全国人民代表大会",
      "xgzlHighLight": null,
      "flxz": "法律",
      "zdjgCodeId": 100,
      "flfgCodeId": 120,
      "titleHightLightList": [
        { "value": "中华人民共和国", "highLight": false },
        { "value": "民法典", "highLight": true }
      ],
      "score": 61.553825
    }
  ],
  "code": 200,
  "msg": "查询成功",
  "searchType": 2,
  "searchContent": null
}
```

`rows[]` 字段说明：

| 字段 | 说明 |
| --- | --- |
| `bbbs` | **全局唯一 ID**，详情 / 下载 / 推荐全部依赖它 |
| `title` | 标题，含 `<em class='highlight'>` 高亮标签 |
| `gbrq` | 公布日期 `YYYY-MM-DD` |
| `sxrq` | 施行日期 `YYYY-MM-DD`，可能为 `null` |
| `sxx` | 时效性码值（1/2/3/4） |
| `zdjgName` | 制定机关名称 |
| `flxz` | 法规性质/类别中文名（法律、行政法规、司法解释、地方性法规…） |
| `flfgCodeId` | 分类编码 |
| `zdjgCodeId` | 机关编码 |
| `titleHightLightList` | 标题分词 + 命中标记，清洗高亮时可直接用 |
| `score` | 相关性得分，默认排序时降序 |
| `xgzlHighLight` | 相关法规命中片段，未命中为 `null` |

**curl 复现**：

```bash
curl -s 'https://flk.npc.gov.cn/law-search/search/list' \
  -H 'Content-Type: application/json' \
  --data '{"searchRange":1,"sxrq":[],"gbrq":[],"sxx":[],"searchType":2,"xgzlSearch":false,"searchContent":"民法典","orderByParam":{"order":"-1","sort":""},"flfgCodeId":[],"zdjgCodeId":[],"gbrqYear":[],"pageNum":1,"pageSize":20}'
```

**实例：按分类 + 时效性拉全量（民法商法类、现行有效）**

```json
{
  "searchContent": "", "searchType": 2, "searchRange": 2, "xgzlSearch": false,
  "flfgCodeId": [120], "zdjgCodeId": [], "sxx": [3], "gbrqYear": [], "gbrq": [], "sxrq": [],
  "orderByParam": { "order": "gbrq", "sort": "DESC" },
  "pageNum": 1, "pageSize": 100
}
```

### 5.2 命中高亮 `search/hitDisplay`

```
POST /law-search/search/hitDisplay
```

```json
{
  "bbbs": "ff808081729d1efe01729d50b5c500bf",
  "searchContent": "违约金",
  "searchType": 1,
  "searchRange": 1
}
```

响应：

```json
{
  "msg": "操作成功",
  "code": 200,
  "data": {
    "contentHitDisplay": [
      "约定的<em class='highlight'>违</em><em class='highlight'>约</em><em class='highlight'>金</em>低于造成的损失的，……"
    ]
  }
}
```

注意高亮是按**单字**包标签的，做摘要需要自己合并相邻 `<em>`。

### 5.3 相关法规 `search/xgzl`

```
POST /law-search/search/xgzl
```

请求体与 `hitDisplay` 完全相同（`bbbs` + `searchContent` + `searchType` + `searchRange`），额外返回相关法规列表：

```json
{
  "msg": "操作成功",
  "code": 200,
  "data": { "contentHitDisplay": null, "xgzlList": [] }
}
```

> `searchContent` 传空串会返回 `{"code":500,"msg":"参数异常"}`，必须带关键词。

### 5.4 高级检索 `highSearch/highSearch`

```
POST /law-search/highSearch/highSearch
```

与普通检索的区别：用 `dataList` 条件组替代单一关键词，支持多字段布尔组合。

**抓包原文**：

```json
{
  "dataList": [
    { "fieldName": "title", "values": ["民法典"], "link": 0, "searchType": 2, "index": 1 }
  ],
  "orderByParam": { "order": "gbrq", "sort": "DESC" },
  "pageNum": 1,
  "pageSize": 20
}
```

| 字段 | 说明 |
| --- | --- |
| `fieldName` | `title`（标题）/ `content`（全文）/ `flfg_code_id`（分类）/ `zdjg_code_id`（机关）/ `xgzl.title`（相关资料标题）/ `xgzl.content`（相关资料全文） |
| `values` | 值数组；分类、机关填 codeId |
| `link` | 0 并且 / 1 或者 / 2 不含 |
| `searchType` | 1 精确 / 2 模糊 |
| `index` | 条件序号，前端用于回显 |

响应结构与 `search/list` 一致（`total` + `rows` + `code` + `msg`）。

实测：

```bash
# 标题含「民法典」
curl -s 'https://flk.npc.gov.cn/law-search/highSearch/highSearch' \
  -H 'Content-Type: application/json' \
  --data '{"dataList":[{"fieldName":"title","values":["民法典"],"link":0,"searchType":2}],"orderByParam":{"order":"-1","sort":""},"pageNum":1,"pageSize":2}'
# => total 894

# 分类 = 宪法(100)
curl -s 'https://flk.npc.gov.cn/law-search/highSearch/highSearch' \
  -H 'Content-Type: application/json' \
  --data '{"dataList":[{"fieldName":"flfg_code_id","values":[100],"link":0,"searchType":2}],"orderByParam":{"order":"-1","sort":""},"pageNum":1,"pageSize":2}'
# => total 7
```

### 5.5 高级检索的命中 / 相关

```
POST /law-search/highSearch/hitDisplay   body: { "bbbs": "...", "dataList": [ ...同上... ] }
POST /law-search/highSearch/xgzl         body: { "bbbs": "...", "dataList": [ ...同上... ] }
```

`highSearch/hitDisplay` 在无命中时返回 `{"code":200,"data":null}`；`highSearch/xgzl` 返回 `{"data":{"contentHitDisplay":null,"xgzlList":[]}}`。

---

## 6. 法律详情

### 6.1 法规详情 `search/flfgDetails`

```
GET https://flk.npc.gov.cn/law-search/search/flfgDetails?bbbs=<bbbs>
```

参数名是 **`bbbs`**。传 `id=` 会报 `Required request parameter 'bbbs'`。

实测（民法典）：

```json
{
  "msg": "操作成功",
  "code": 200,
  "data": {
    "bbbs": "ff808081729d1efe01729d50b5c500bf",
    "title": "中华人民共和国民法典",
    "flxz": "法律",
    "zdjgName": "全国人民代表大会",
    "gbrq": "2020-05-28",
    "sxrq": "2021-01-01",
    "sxx": 3,
    "xfFlag": 0,
    "ossFile": {
      "ossWordPath": "prod/20200528/827f65fcb68f40cb941eed996c5212b0.docx",
      "ossWordOfdPath": "prod/20200528/827f65fcb68f40cb941eed996c5212b0.ofd",
      "ossWordOfdSize": 814829,
      "ossPdfPath": "prod/20200528/bd53dd912c1048f2aecbaa229238334b.pdf",
      "ossPdfOfdPath": "prod/20200528/bd53dd912c1048f2aecbaa229238334b.ofd",
      "ossPdfOfdSize": 6414515
    },
    "content": { "id": "...", "parentId": "...", "title": "中华人民共和国民法典", "index": "0", "children": [ ... ] },
    "lsyg": [ { "bbbs": "...", "title": "中华人民共和国刑法", "gbrq": "2020-12-26", "highLight": true } ],
    "xgwj": [],
    "xgzl": [
      { "fileId": "ff8081818d6a424b018e092277921789", "title": "中华人民共和国主席令（第十五号）", "titleHighLight": null, "busiType": "主席令", "fileType": "docx", "titleHightLightList": null }
    ],
    "flfg": null
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `bbbs` | 法规 ID |
| `title` / `flxz` / `zdjgName` / `gbrq` / `sxrq` / `sxx` | 同上 |
| `xfFlag` | 1 = 宪法（前端据此切「宪法」版式），0 = 普通法律 |
| `ossFile` | 原始文件在对象存储上的相对路径（**下载接口要吃的是 `bbbs`，不是这个路径**，但 `previewLink` 吃的是它） |
| `content` | 目录树（章节层级），**可能为 `null`**，且**不含正文文本** |
| `lsyg` | 历史沿革：同一部法律的历次版本 `[{bbbs,title,gbrq,highLight}]` |
| `xgwj` | 相关文书（修改/废止决定等） |
| `xgzl` | 相关文件：主席令、草案说明等，含 `fileId` / `busiType` / `fileType` |
| `flfg` | 关联法规对象，通常 `null` |

**关于正文的重要结论**：
`content` 只提供「题注 / 编 / 章 / 节 / 条」的**层级目录**（节点字段 `id`、`parentId`、`title`、`index`、`children`），**没有条文文本**；正文必须走 `download/pc`（docx/pdf）或 `previewLink`（OFD）。
实测地方法规的 `content` 直接是 `null`（如「海南自由贸易港城市更新条例」），所以不要依赖它判断法律是否存在。

### 6.2 修改/废止决定 `search/xgwjDetails`

```
GET /law-search/search/xgwjDetails?bbbs=<bbbs>
```

返回结构与 `flfgDetails` 完全一致，用于详情页 `type=decision` 场景（列表里 `flxz === "修改、废止的决定"` 的条目）。

### 6.3 相关文件详情 `search/xgzlDetails`

```
GET /law-search/search/xgzlDetails?bbbs=<法规bbbs>&fileId=<fileId>
```

`fileId` 来自 `flfgDetails.data.xgzl[].fileId`，缺失会报 `Required request parameter 'fileId'`。

```json
{
  "msg": "操作成功",
  "code": 200,
  "data": {
    "fileId": "ff8081818d6a424b018e092277921789",
    "title": "中华人民共和国主席令（第十五号）",
    "busiType": null,
    "ossFilePath": "prod/20231229/95062799a78f415e96ca409a67cf11df.docx",
    "ossOfdPath": "prod/20231229/95062799a78f415e96ca409a67cf11df.ofd",
    "ossOfdSize": 18881,
    "ofdType": 1
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `ossFilePath` | docx/pdf 原始路径 |
| `ossOfdPath` | OFD 路径（预览用） |
| `ofdType` | 1 = 用 WPS 版式渲染，其它值走 OFD 阅读器 |

### 6.4 关联推荐 `search/recommend`

```
GET /law-search/search/recommend?bbbs=<bbbs>
```

响应 `data` 是 `rows` 同构的数组（`bbbs` / `title` / `gbrq` / `sxrq` / `sxx` / `zdjgName` / `flxz` / `score`），详情页右侧「关联推荐」用它。

---

## 7. 下载与预览

### 7.1 单文件下载 `download/pc`

```
GET https://flk.npc.gov.cn/law-search/download/pc?format=docx&bbbs=<bbbs>&fileId=
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `bbbs` | 是 | 法规 ID（缺失会报 `Required request parameter 'bbbs'`） |
| `format` | 是 | `docx` 或 `pdf` |
| `fileId` | 否 | 下载「相关文件」时传（配合 `bbbs` = 主法规 ID），否则留空 |

实测响应：

```json
{
  "msg": "操作成功",
  "code": 200,
  "data": {
    "urlIn": "http://172.16.220.27:38080/law-search/file/download?filePath=/prod/20200528/827f65fcb68f40cb941eed996c5212b0.docx&fileName=中华人民共和国民法典_20200528.docx&response-content-disposition=attachment;filename=\"中华人民共和国民法典_20200528.docx\"",
    "url": "https://flkoss.obs-bj2.cucloud.cn/prod/20200528/827f65fcb68f40cb941eed996c5212b0.docx?response-content-disposition=attachment%3B%20filename%3D%22...%22&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20261026T152549Z&X-Amz-SignedHeaders=host&X-Amz-Expires=3600&X-Amz-Credential=...&X-Amz-Signature=..."
  }
}
```

- `urlIn` 是**内网地址**（`172.16.x.x`），外网不可用，别用。
- `url` 是**公网可直下的 OBS 预签名地址**，`X-Amz-Expires=3600`，**1 小时后失效**，过期需重新调本接口换新链接。
- 下载文件名形如 `中华人民共和国民法典_20200528.docx`（标题 + 公布日期）。

**下载有效性已验证**：

```bash
BBBS=ff808081729d1efe01729d50b5c500bf
URL=$(curl -s "https://flk.npc.gov.cn/law-search/download/pc?format=docx&bbbs=$BBBS&fileId=" \
      | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["url"])')
curl -sL "$URL" -o 民法典.docx
file 民法典.docx      # Microsoft Word 2007+
unzip -l 民法典.docx  # 18 个条目：[Content_Types].xml / word/document.xml ...
# 大小 197879 字节，Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

PDF 同理，把 `format` 换成 `pdf`。

**下载相关文件**（如主席令）：

```bash
curl -s "https://flk.npc.gov.cn/law-search/download/pc?format=docx&bbbs=ff8081818c9108eb018cb6922f750c07&fileId=ff8081818d6a424b018e092277921789"
# => fileName=中华人民共和国主席令（第十五号）.docx
```

### 7.2 批量下载 `download/batch`

```
POST https://flk.npc.gov.cn/law-search/download/batch
Content-Type: application/json
```

请求体是**数组**（不是对象），每项 `{bbbs, format}`：

```json
[
  { "bbbs": "ff808081729d1efe01729d50b5c500bf", "format": "docx" },
  { "bbbs": "ff808181796a636a0179822a19640c92", "format": "pdf" }
]
```

响应 `data` 是与入参顺序一致的 URL 数组：

```json
{ "msg": "操作成功", "code": 200, "data": [ { "urlIn": "...", "url": "https://flkoss..." }, { "urlIn": "...", "url": "..." } ] }
```

前端的「批量下载」是拿到这些 URL 后逐个拉流、在浏览器里打成一个 zip（文件名 `国家法律法规数据库_批量下载_<时间戳>.zip`），服务端**不做打包**。
批量接口偶发 502（WAF/网关），重试即可；单次别塞太多条。

### 7.3 在线预览 `amazonFile/previewLink`

```
GET https://flk.npc.gov.cn/law-search/amazonFile/previewLink?filePath=prod/20200528/827f65fcb68f40cb941eed996c5212b0.ofd
```

`filePath` 取 `ossFile.ossWordOfdPath`（WPS 版本）或 `ossFile.ossPdfOfdPath`（公报原版），**不要带前导斜杠**。

```json
{
  "msg": "获取预览链接成功！",
  "code": 200,
  "data": {
    "urlIn": "http://172.16.220.10:8095/reader?file=http://172.16.220.27:38080/law-search/amazonFile/ofdGenerateLink?filePath=...",
    "url": "https://flkofd.npc.gov.cn/reader?file=https://flk.npc.gov.cn/law-search/amazonFile/ofdGenerateLink?filePath=...&_wr_timestamp=...&_wr_app_id=...&_wr_sign=..."
  }
}
```

`url` 指向 OFD 阅读器 `https://flkofd.npc.gov.cn/reader`，详情页就是把它塞进 `<iframe id="previewIframe">`。
传 `.docx` 路径也能返回链接（后台会先转 OFD），但预览效果以 OFD 为准。

---

## 8. 纠错与杂项

### 8.1 验证码

```
GET /law-search/index/captchaImage
```

```json
{ "msg": "操作成功", "code": 200, "img": "/9j/4AAQSkZJRgAB...（base64 JPEG）", "uuid": "908a764f9ac546979c8ec0cbeecc9b18" }
```

`uuid` 提交纠错时要原样回传。

### 8.2 提交纠错

```
POST /law-search/index/fljc
```

```json
{
  "cwlx": 2,
  "ymdz": "https://flk.npc.gov.cn/detail?id=...",
  "title": "中华人民共和国民法典",
  "wtms": "问题描述",
  "name": "姓名",
  "phone": "手机号",
  "email": "邮箱",
  "code": "验证码",
  "captcha": "验证码",
  "uuid": "captchaImage 返回的 uuid",
  "fljcFileList": ["上传后的图片 URL"],
  "source": 0
}
```

`cwlx`（错误类型）取值：`0` 日期有误 / `1` 时效性有误 / `2` 文字错误 / `4` 版本未更新 / `6` 页面查找不到 / `7` 其他错误。

验证码错误或 `uuid` 过期时返回 `{"code":500,"msg":"验证码已过期，请点击验证码刷新"}`。

### 8.3 图片上传

```
POST /law-search/file/upload      (multipart/form-data，前端用 el-upload 默认字段名 `file`，未逐个实测)
```

响应同下载接口，含 `url`（公网）/ `urlIn`（内网），前端取公网地址塞进 `fljcFileList`。单文件限制 20MB。

### 8.4 问卷配置

```
GET /law-search/index/wjConfig
=> {"data":{"activityId":"tjKyJMA","appId":"wxd947200f82267e58","pcPath":"https://v.wjx.cn/vm/tjKyJMA.aspx"}}
```

前端满意度问卷弹窗用，与法规数据无关。

---

## 9. 字段与编码附录

### 9.1 法律法规分类 `flfgfl`

| level | 名称 | codeId |
| --- | --- | --- |
| 1 | 宪法 | 100 |
| 1 | 法律 | 101 |
| 2 | 法律 | 102 |
| 3 | 宪法相关法 | 110 |
| 3 | 民法商法 | 120 |
| 3 | 行政法 | 130 |
| 3 | 经济法 | 140 |
| 3 | 社会法 | 150 |
| 3 | 生态环境法 | 155 |
| 3 | 刑法 | 160 |
| 3 | 诉讼与非诉讼程序法 | 170 |
| 2 | 法律解释 | 180 |
| 2 | 有关法律问题和重大问题的决定（部分） | 190 |
| 2 | 修正案 | 195 |
| 2 | 修改、废止的决定 | 200 |
| 1 | 行政法规 | 201 |
| 2 | 行政法规 | 210 |
| 2 | 修改、废止的决定 | 215 |
| 1 | 监察法规 | 220 |
| 1 | 地方法规 | 221 |
| 2 | 地方法规 | 222 |
| 3 | 地方性法规 | 230 |
| 3 | 自治条例 | 260 |
| 3 | 单行条例 | 270 |
| 3 | 经济特区法规 | 290 |
| 3 | 浦东新区法规 | 295 |
| 3 | 海南自由贸易港法规 | 300 |
| 2 | 法规性决定 | 305 |
| 2 | 修改、废止的决定 | 310 |
| 1 | 司法解释 | 311 |
| 2 | 高法司法解释 | 320 |
| 2 | 高检司法解释 | 330 |
| 2 | 联合发布司法解释 | 340 |
| 2 | 修改、废止的决定 | 350 |

> 同名「法律」「地方法规」在不同 level 下 codeId 不同：`101` 是法律大类，`102` 才是「法律（含子类）」节点；拉全部法律建议直接用 `codeIdList`。

### 9.2 制定机关 `zdjgfl`

| level | 名称 | codeId |
| --- | --- | --- |
| 1 | 全国人大及其常委会 | 90 |
| 2 | 全国人大 | 100 |
| 2 | 全国人大常委会 | 110 |
| 1 | 国务院 | 120 |
| 1 | 国家监察委员会 | 130 |
| 1 | 最高人民法院 | 140 |
| 1 | 最高人民检察院 | 150 |
| 1 | 地方人大及其常委会 | 165 |
| 2 | 北京 | 170 |
| 2 | 天津 | 180 |
| 2 | 河北 | 190 |
| 2 | 山西 | 200 |
| 2 | 内蒙古 | 210 |
| 2 | 辽宁 | 220 |
| 2 | 吉林 | 230 |
| 2 | 黑龙江 | 240 |
| 2 | 上海 | 250 |
| 2 | 江苏 | 260 |
| 2 | 浙江 | 270 |
| 2 | 安徽 | 280 |
| 2 | 福建 | 290 |
| 2 | 江西 | 300 |
| 2 | 山东 | 310 |
| 2 | 河南 | 320 |
| 2 | 湖北 | 330 |
| 2 | 湖南 | 340 |
| 2 | 广东 | 350 |
| 2 | 广西 | 360 |
| 2 | 海南 | 370 |
| 2 | 重庆 | 380 |
| 2 | 四川 | 390 |
| 2 | 贵州 | 400 |
| 2 | 云南 | 410 |
| 2 | 西藏 | 420 |
| 2 | 陕西 | 430 |
| 2 | 甘肃 | 440 |
| 2 | 青海 | 450 |
| 2 | 宁夏 | 460 |
| 2 | 新疆 | 470 |

### 9.3 时效性 `sxx`

| 值 | 含义 |
| --- | --- |
| 1 | 已废止 |
| 2 | 已修改 |
| 3 | 有效 |
| 4 | 尚未生效 |

### 9.4 其它枚举

| 字段 | 值 |
| --- | --- |
| `format` | `docx` / `pdf` |
| `link`（高级检索） | `0` 并且 / `1` 或者 / `2` 不含 |
| `searchType` | `1` 精确 / `2` 模糊 |
| `searchRange` | `1` 标题 / `2` 全文 |
| `cwlx`（纠错类型） | `0` 日期有误 / `1` 时效性有误 / `2` 文字错误 / `4` 版本未更新 / `6` 页面查找不到 / `7` 其他错误 |

---

## 10. 踩坑与采集建议

1. **`orderByParam` 必须是对象**。写成 `[]` 一定 500，这是自己拼 payload 时最容易踩的坑。
2. **HTTP 200 不代表成功**，一律判 `body.code === 200`。
3. **详情参数是 `bbbs`**，不是 `id`；`id` 只是前端路由 query 的名字。
4. **下载直链 1 小时过期**（`X-Amz-Expires=3600`）。要长期保存请立刻落盘，别把 `url` 存库当永久链接；需要时用 `bbbs` 重新换链。
5. **`urlIn` 是内网地址**（`172.16.x.x`），外网请求会超时，只认 `url`。
6. **`content` 不含正文**，只有章节目录，且可能为 `null`；正文请取 docx / pdf / OFD。
7. **高亮是按字切的**：`<em class='highlight'>违</em><em class='highlight'>约</em><em class='highlight'>金</em>`，做摘要要先合并再清洗标签。
8. **标题里的 `<em>` 会污染文件名**，保存 docx 时用接口给的 `fileName` 或自行清洗后再命名。
9. **分页深度**：`pageSize` 实测可到 200；全量 1.5 万条地方法规建议按 `flfgCodeId` + `gbrqYear` 分片，别指望深翻页。
10. **限速**：站前有 WZWS WAF，单 IP 并发建议 ≤ 2、间隔 ≥ 300ms；出现 502 或 `系统异常` 就退避重试，别硬刚。
11. **批量下载接口偶发 502**，且服务端不打包，本质就是 N 个预签名链接，量大时自己控制并发。
12. **`prompts/search` 用 `title` 参数**，不是 `searchContent`。

---

## 11. 可直接运行的采集示例

### 11.1 拉全量列表 + 下载 docx（Python）

```python
import json, time, urllib.request

BASE = "https://flk.npc.gov.cn"
UA = {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}


def post(path, payload):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(), headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=60))


def get(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "Mozilla/5.0"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def iter_laws(flfg_code_id=None, sxx=(3,), page_size=100):
    page = 1
    while True:
        body = {
            "searchContent": "", "searchType": 2, "searchRange": 2, "xgzlSearch": False,
            "flfgCodeId": flfg_code_id or [], "zdjgCodeId": [], "sxx": list(sxx),
            "gbrqYear": [], "gbrq": [], "sxrq": [],
            "orderByParam": {"order": "gbrq", "sort": "DESC"},
            "pageNum": page, "pageSize": page_size,
        }
        data = post("/law-search/search/list", body)
        if data.get("code") != 200:
            raise RuntimeError(data)
        rows = data.get("rows") or []
        if not rows:
            return
        for r in rows:
            yield r
        if page * page_size >= data["total"]:
            return
        page += 1
        time.sleep(0.3)


def download_docx(bbbs, out_path):
    d = get(f"/law-search/download/pc?format=docx&bbbs={bbbs}&fileId=")
    url = d["data"]["url"]                      # 预签名，1 小时内有效
    with urllib.request.urlopen(url, timeout=120) as r, open(out_path, "wb") as f:
        f.write(r.read())


if __name__ == "__main__":
    # 注意：flfgCodeId 只认叶子编码。[120] = 民法商法；
    # 想要"法律"整类，传 enumData 里法律节点的 codeIdList（101,102,110,...,200）
    for law in iter_laws(flfg_code_id=[120], sxx=(3,)):
        print(law["bbbs"], law["title"].replace("<em class='highlight'>", "").replace("</em>", ""))
        # download_docx(law["bbbs"], f"laws/{law['bbbs']}.docx")
```

### 11.2 抓包/调试小技巧

想自己复现抓包，可在目标页 DevTools 里挂钩 XHR 原型（axios 会缓存构造器，**挂构造器无效，必须挂原型**）：

```js
window.__cap = [];
const P = XMLHttpRequest.prototype, oOpen = P.open, oSend = P.send;
P.open = function (m, u) { this.__m = m; this.__u = u; return oOpen.apply(this, arguments); };
P.send = function (b) {
  if (String(this.__u).includes('law-search')) window.__cap.push({ m: this.__m, u: this.__u, body: b });
  return oSend.apply(this, arguments);
};
// 操作页面后：JSON.stringify(window.__cap)
```

拿到的 `body` 就是本文件里各接口的请求体原文。

---

## 12. 拉取全站列表

**唯一入口就是 `POST /law-search/search/list`**，没有"导出全站"的专用接口。把 `searchContent` 置空、所有筛选数组置空，就是全站枚举。

### 12.1 结论：一次请求拉全

```json
{
  "searchContent": "", "searchType": 2, "searchRange": 2, "xgzlSearch": false,
  "flfgCodeId": [], "zdjgCodeId": [], "sxx": [], "gbrqYear": [], "gbrq": [], "sxrq": [],
  "orderByParam": { "order": "gbrq", "sort": "DESC" },
  "pageNum": 1, "pageSize": 40000
}
```

实测（2026-10-27）：

| 指标 | 值 |
| --- | --- |
| `total` | **31085** |
| 返回 `rows` | 31085（`bbbs` 去重后仍 31085，无重复） |
| 响应体积 | 12 488 400 字节（≈12.5 MB） |
| 耗时 | 38 s（另一次 97 s，随网络波动） |
| 两次独立请求 `total` | 均为 31085，稳定 |

`pageSize` 超过 `total` 时服务端直接返回全部，不截断（试过 35000、40000 都完整）。

### 12.2 为什么不要用分页翻

**`search/list` 的分页排序不稳定**，实测证据：

- 同一请求（`gbrq DESC`、`pageSize=1000`、`pageNum=1`）连续两次，**有 71 个位置的元素互换**；
- 默认排序（`order:-1`）下同样不稳定（`score` 全为 0，全是并列）。

原因是并列记录没有稳定 tiebreaker（`bbbs` 不参与排序）。**翻页会重复 + 漏项**，31 页翻下来很难对齐 `total`。

深翻页本身是通的（`pageSize=1000` 翻到第 32 页仍返回 85 条），所以问题不是"翻不动"，而是"翻不准"。

> 如果确实要分页（比如内存吃紧），策略是：每页拉完立刻按 `bbbs` 去重入库，最后用 `total` 对账，缺的再用「分类 × 机关 × 年份」小切片补 —— 别指望一次翻页就齐。

### 12.3 稳妥的分片方案

每个切片压到「单请求就能装下」（`pageSize` 给足、`pageNum=1`），规避并列排序问题：

```
切片 = flfgCodeId(叶子) × zdjgCodeId(机关) × gbrqYear(年份)
```

- 省级地方库最大是广东 1814 条，`pageSize=2000` 一省一次请求即可；
- 法律类 734 条、行政法规 834 条、司法解释 859 条，各一次请求；
- 全站约 40~60 次请求，每次 1~3 秒，比单次 12.5 MB 更抗失败、可断点续。

### 12.4 全站构成（2026-10-27 实测，用于对账）

按 `flxz`：

| flxz | 条数 |
| --- | --- |
| 地方法规 | 26194 |
| 修改、废止的决定 | 2069 |
| 司法解释 | 859 |
| 行政法规 | 834 |
| 法律 | 477 |
| 法规性决定 | 414 |
| 有关法律问题和重大问题的决定（部分） | 188 |
| 法律解释 | 27 |
| 修正案 | 12 |
| 宪法 | 7 |
| 监察法规 | 3 |
| （空） | 1 |
| **合计** | **31085** |

按 `sxx`：

| sxx | 含义 | 条数 |
| --- | --- | --- |
| 3 | 有效 | 17243 |
| 2 | 已修改 | 8223 |
| 1 | 已废止 | 3260 |
| `null` | 未标注 | 2259 |
| 4 | 尚未生效 | 60 |
| -1 | 未知码值 | 40 |

> 注意：`total` 31085 远大于首页 `flflCount` 之和（约 1.7 万）。首页统计只数"法规本体"，而 `search/list` 把**修改/废止决定、法规性决定、空 flxz 的条目**一并算进来了。做"法律清单"时要按 `flxz` / `sxx` 过滤，不能直接全量照单全收。

### 12.5 注意

- **WAF 限流**：连续快速请求会返回 **HTTP 307 重定向**（不是 200 也不是 502），退避几秒后恢复。批量跑务必加 300~500ms 间隔。
- 单次 12.5 MB 的请求建议设 `timeout ≥ 180s`，并准备好失败重试。
- 拿到的 `title` 含 `<em class='highlight'>`，`bbbs` 才是稳定主键。

---

## 附：页面路由与详情链接格式

| 路由 | 说明 |
| --- | --- |
| `/index` | 首页 |
| `/search` | 检索结果页（`?searchContent=&searchType=` 等 query 会回填） |
| `/advanceSearch` | 高级检索 |
| `/detail` | 详情页，`?id=<bbbs>&fileId=&type=&title=` |
| `/error-correction` | 纠错页，`?title=<标题>` |

详情链接示例：

```
https://flk.npc.gov.cn/detail?id=ff808081729d1efe01729d50b5c500bf&fileId=&type=&title=中华人民共和国民法典
```

- `type=decision`：列表项 `flxz === "修改、废止的决定"` 时走 `xgwjDetails`
- `type=relevantResource` + `fileId`：走 `xgzlDetails`
- `type=relevantDocuments`：显示主法规的相关文件列表
