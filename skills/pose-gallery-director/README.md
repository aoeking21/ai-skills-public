# pose-gallery-director

姿势图库导演：按中文关键词检索姿势、服装、人像参考图，并把选中的姿势接进写真摄影工作流。

## 安装

```bash
npx skills add aoeking21/ai-skills-public --skill pose-gallery-director -g -a codex -y
```

或直接复制 `skills/pose-gallery-director/` 到你的 skills 目录。

## 用法

```bash
# 找姿势（默认安全模式）
python3 skills/pose-gallery-director/scripts/pose_search.py 坐姿

# 找服装 / 人像
python3 skills/pose-gallery-director/scripts/pose_search.py 连衣裙 --kind costume
python3 skills/pose-gallery-director/scripts/pose_search.py 短发 --kind portrait

# 用户挑中后，只拉那一张原图
python3 skills/pose-gallery-director/scripts/pose_search.py 后仰坐 --fetch --out ./pose-picks/
```

首次运行会下载三份目录 JSON（约 2 MB）到 `~/.cache/pose-gallery-director/`。图片按需单张拉取，不批量下载。

## 融合位置

- 身份与连续性：`skills/aoeking-xiezhen-director`（姿势进其执行顺序第 5 步之后）
- 风格与路线：`image-generation/female-portrait-director`（姿势只提供动作，不决定路线）
- 通用总控与质量门：`skills/portrait-master-director`

完整融合设计见 `docs/photography-pose-fusion-v1.0.md`，合同见 `references/pose-fusion-contract.md`。

## 来源与许可

原版是日本作者ギア（@giaaibusi）的 ai-pose-gallery，中文镜像是 anhao/ai-pose-gallery-zh。图库图片与数据不在本仓库分发，版权归原作者，禁止打包倒卖与批量下载。详情见 `references/pose-catalog-source.md`。
