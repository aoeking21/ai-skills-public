---
name: jev-artifact-worker
description: JEV 统一 Artifact Factory。将结构化 JSON Artifact Spec 路由到 Desktop-05，按 Artifact Profile 生成 DOCX/XLSX/PPTX/PDF，并执行格式级 QA。Office 格式由 OfficeCLI 生成与 validate；PDF 由 jev-pdf-engine 生成并执行文本回读+渲染 QA。默认输出仅允许写入 JEV Broker 的 artifacts/tasks 根目录。
---

# JEV Artifact Worker

## Role
统一文档成品执行器，不负责决定内容本身。

## Default node
Desktop-05。

## Input contract
JSON Artifact Spec 至少包含：
- artifact_id
- format: docx | xlsx | pptx | pdf
- profile
- format-specific content
- critical_contains 或 critical_cells

## Pipeline
REQUEST → CONTENT → ARTIFACT SPEC → GENERATE → VALIDATE → READBACK/RENDER QA → PASS → DELIVER → ARCHIVE

## Engines
- DOCX/XLSX/PPTX: OfficeCLI
- PDF: jev-pdf-engine
- Profiles: artifact-profiles.json

## Safety
- 输出只能落在 Desktop-05 JEV Broker 自己的 artifacts/tasks 根目录。
- artifact_id 只允许安全字符。
- 不把用户给出的绝对路径当作输出路径。
- 生成退出码为 0 不等于完成，必须 QA PASS。
- Delivery 与 Archive 分离；Archive 失败不得阻塞已 QA PASS 的成品交付。

## Retry
OfficeCLI 异常重试前先 close 同名 resident document，避免 stale handle 造成假失败。

## Known validated behavior
- DOCX: OpenXML validate + critical text readback
- XLSX: OpenXML validate + critical cell readback
- PPTX: OpenXML validate + slide text readback；样式修改使用 numeric shape index
- PDF: embedded Chinese font + critical text extraction + 150 DPI raster QA
