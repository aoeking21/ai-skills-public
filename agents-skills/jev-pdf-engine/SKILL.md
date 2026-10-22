---
name: jev-pdf-engine
description: JEV 的独立 PDF Artifact Engine。用于在 Desktop-05 生成和验收 PDF，采用 JSON Artifact Spec + ReportLab + Noto Sans SC + PyMuPDF 渲染 QA。PDF 不视为 OfficeCLI 原生能力。默认生产节点 Desktop-05；生成后必须重新打开、文本校验并渲染检查。
---

# JEV PDF Engine

## Role
PDF 是独立 Artifact Capability，不挂靠 OfficeCLI。

## Preferred node
Desktop-05。

## Engine
- generator: ReportLab
- font: private Noto Sans SC under JEV Broker
- validator/renderer: PyMuPDF
- command: ~/.local/share/jev-broker/pdf-engine/venv/bin/python ~/.local/share/jev-broker/pdf-engine/jev_pdf_engine.py

## Required workflow
1. Build JSON Artifact Spec.
2. Run `create --spec <spec.json> --output <out.pdf>`.
3. Run `validate <out.pdf> --contains <critical text>...`.
4. Delivery is allowed only when validation returns `ok: true`.
5. Keep rendered PNGs as QA evidence during production; final delivery folder should contain only intended final artifacts.

## Safety and quality
- Do not assume a PDF is valid because generation exited 0.
- Chinese output must use embedded Noto Sans SC.
- Missing critical text, zero pages, or failed raster QA means FAIL and requires regeneration.
- For long text-heavy documents, prefer authoring content from a shared Artifact Spec; do not silently route PDF through OfficeCLI.
