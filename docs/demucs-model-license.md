# HTDemucs 6-stem 模型与授权说明（Demucs Model & License）

> 本文档说明本项目引入的**音乐分轨模型**（HTDemucs 6-stem，ONNX）的来源、体积、版本选择与授权条款。
> 状态：**已落地（权重由脚本按需下载，未提交进 git）**。入口/实现细节后续再讨论。

---

## 1. 模型选择

选用 **`htdemucs_6s`（HTDemucs v4 六源版）**，以 **WebGPU 兼容 ONNX** 形式引入。

| 项 | 值 |
|----|-----|
| 模型 | `htdemucs_6s`（Hybrid Transformer Demucs v4，6 源） |
| 分轨 | **drums（鼓）/ bass（贝斯）/ other（其他）/ vocals（人声）/ guitar（吉他）/ piano（钢琴）** |
| 权重文件 | `htdemucs_6s.onnx` |
| 权重体积 | **284,797,240 字节（≈ 284.8 MB，fp32）**，已实测（`x-linked-size` 与下载 Content-Length 一致） |
| ONNX I/O | 输入 `mix [1,2,343980]` → 输出 `stems [1,6,2,343980]` |
| 推理运行时 | `onnxruntime-web`（WASM / WebGPU 后端） |

### 为什么是这个版本（含体积实测对比）

此前已实测各版本 ONNX 真实体积（字节数，非估算）：

| 版本 | 轨道 | 来源 | 真实体积 |
|------|------|------|---------|
| htdemucs（基准） | 4 | bakkot/demucs-js | 174.3 MB |
| htdemucs（基准） | 4 | gianlourbano | 174.5 MB |
| htdemucs（基准，embedded） | 4 | kramp | 180.5 MB |
| htdemucs_ft | 4 | StemSplitio | 316.4 MB/轨（分开导出） |
| htdemucs_6s | 6 | StemSplitio | 258.2 MB |
| **htdemucs_6s（webgpu）** | **6** | **kramp** | **284.8 MB** ← 本项目选用 |
| htdemucs_6s（fp16） | 6 | StemSplitio | 136.4 MB |

选 `kramp/htdemucs-6s-webgpu-onnx` 的原因：

1. **浏览器可直接跑**：原版 `StemSplitio` 的 ONNX 内嵌 iSTFT 含 `ConstantOfShape` 算子，`onnxruntime-web` 的 **WebGPU 后端无法执行**；`kramp` 版已离线把该节点折叠为 `Constant`，输入窗口固定时输出**与原版 bit-identical**，专为浏览器 WebGPU 设计（有实际使用的 Space：`kramp/audio-split`）。
2. **六源**：相比 4 轨基准多出吉他/钢琴，适合本项目希望保留更多轨道的分轨诉求。
3. **体积可接受**：284.8 MB，处于 6 源 fp32 的正常量级（fp16 可再减半到 ~136 MB，后续如需省带宽可再引入 fp16 变体）。

---

## 2. 来源链条

```
Meta Demucs v4 (PyTorch 权重, research-only)
   └─> StemSplitio/htdemucs-6s-onnx   (ONNX 导出, MIT 标注)
          └─> kramp/htdemucs-6s-webgpu-onnx  (constant-folded, WebGPU 兼容, MIT 标注)
                 └─> scripts/vendor-demucs.sh 下载到 public/assets/demucs/models/
```

- 原始权重：Meta Facebook Research **Demucs v4**（Hybrid Transformer Demucs）
  - 代码仓库：https://github.com/facebookresearch/demucs （**代码 MIT**）
  - 权重：`facebook/demucs`（Hugging Face **gated**，需登录；`bakkot/demucs-js` 明确标注"derived from Meta weights, **for personal and research use only**"）
- ONNX 导出：`StemSplitio/htdemucs-6s-onnx`（模型卡标注 `license: mit`）
- WebGPU 折叠：`kramp/htdemucs-6s-webgpu-onnx`（模型卡标注 `license: mit`，`base_model: StemSplitio/htdemucs-6s-onnx`）

---

## 3. 授权条款（重要）

### 3.1 分层授权

| 对象 | 授权 | 说明 |
|------|------|------|
| Demucs **代码**（PyTorch 实现） | **MIT** | 可自由使用/修改/商用 |
| Demucs **原始权重**（Meta） | **research / personal use only** | **不可商用**；Meta 在 HF 上对 `facebook/demucs` 权重设了 gated 访问 |
| ONNX 导出图（StemSplitio / kramp） | **MIT 标注** | 标注为 MIT，但**只覆盖导出代码与图结构**，不覆盖底层 Meta 权重的原始条款 |

### 3.2 本项目的使用前提

- 本项目**非商业化**（个人 / 研究用途），符合 Meta 权重的 **research / personal use** 限制。
- 若未来转为**商用**，必须更换为可商用权重（例如基于公开可商用数据的 MDX-Net / Band-Split 系模型），或向 Meta 取得商用授权。

### 3.3 合规动作（已落地）

- 权重二进制**未提交进 git**（`.gitignore` 忽略 `public/assets/demucs/`），由 `scripts/vendor-demucs.sh` 按需下载。
- MIT License 全文存于 `public/assets/demucs/licenses/LICENSE-MIT.txt`。
- 来源与授权汇总存于 `public/assets/demucs/licenses/NOTICES.txt`。
- 本文档记录完整来源链条与限制。

---

## 4. 引入方式

```bash
# 下载权重（284.8 MB）到 public/assets/demucs/models/
bash scripts/vendor-demucs.sh
```

脚本会校验文件大小（284,797,240 字节），防止截断或 LFS 存根。运行时只加载本地文件，不做 HF 在线请求。

---

## 5. 后续可选项（不阻塞当前）

- **fp16 变体**：`htdemucs_6s_fp16weights.onnx`（136.4 MB）可省一半带宽/内存，WebGPU 下通常也更快，质量损失很小。当前先固定 fp32 版，入口/实现时再评估是否切换。
- **onnxruntime-web** 打包：仿照 `public/vendor/three`、`public/vendor/rapier` 的 vendor 模式，后续做入口时再把 onnxruntime-web 的 wasm 也 vendor 进 `public/vendor/`。
