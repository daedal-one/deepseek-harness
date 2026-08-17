# Agent Note: 插件清单中的包元数据

Status: implemented

[English](2026-08-17-plugin-inventory-package-metadata.md) | 中文

## 问题

只读“插件列表”通过缩短后的 Loader 模块名称、启停状态与根 Fiber 阶段标识条目。这些事实能说明条目是否运行，却不能说明包的用途、作者或已安装的发布版本。模块子路径、本地文件与 `cordis:` 内置项也会使浏览器侧的包查找不完整，并依赖具体部署。

## 决策

`dsh-host-plugin-inventory` 在 Loader 状态投影旁解析展示元数据。裸模块子路径使用所属包的 manifest（元数据清单），文件类标识从所属条目树的 base URL 开始使用最近的包 manifest，`cordis:` 名称则尝试对应的 `@deepseek-ai/cordis-plugin-*` 包。Remote 条目以可空字符串携带 `author`、`description` 与 `version`。字段缺失、manifest 无法读取或包无法解析时返回 `null`；解析器不会从包 scope 或仓库 URL 推断作者，也不会访问注册表。

已安装包的元数据在网关生命周期内缓存，因为安装变更在重启后生效。启停状态与 Fiber 阶段绝不缓存：每次 `pluginInventory/list` 调用都直接读取当前 Loader 条目及其当前 fiber。

“插件列表”在每张收起的卡片上显示描述、作者与版本。字段缺失时由本地化的不可用文案占位，让所有条目保持相同的信息结构。搜索会在模块标识与 Loader 条目 id 之外匹配已有的元数据。已启用条目的运行阶段使用带边框的文字标签，而不是仅靠颜色的圆点；展开后仍会显示确切的 Loader 条目 id 与配置详情。

## 备选方案

**由 Host 查询包注册表。** 否决，因为私有与本地包可能没有注册表记录，清单会因此依赖网络，而且只读的本地部署视图会向外部服务泄露已安装的包名称。

**从包 scope 或仓库所有者推断作者。** 否决，因为发布者 namespace 与仓库组织不能证明作者身份。明确的不可用文案虽然不够精致，但能保留包实际声明的事实。

**在浏览器中解析包元数据。** 否决，因为浏览器模块图携带的是 client bundle，而不是权威的 Host 安装路径或 manifest；这还会让同一条清单记录分别依赖 Loader 与浏览器派生的来源。

## 影响

清单 Remote payload 为每个条目增加三个可空字符串，首次读取会执行本地 manifest 查找。后续读取复用不可变的已安装包元数据，同时继续读取实时 Loader 状态。包作者通过标准 manifest 字段控制展示文案；技术性较强或缺失的描述会按原文显示或明确标记为不可用，而不会由 Harness 改写。
