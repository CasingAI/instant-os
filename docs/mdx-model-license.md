# MDX-NET 人声增强模型与授权说明（MDX-Net Model & License）

> 本文档说明本项目引入的**人声/伴奏 2-stem 分离模型**（UVR MDX-NET，ONNX）的来源、体积与授权条款。
> 状态：**已落地（权重由脚本按需下载，未提交进 git）**。

---

## 1. 模型选择

选用 **`UVR-MDX-NET-Inst_full_292`**（UVR 社区导出的 MDX-Net 伴奏模型），用于**人声增强**：
在分轨 App 中用 MDX-NET 替换 htdemucs_6s 拆出的人声轨（人声 = 原曲 − 伴奏），
或在音素提取前先提纯人声。

| 项 | 值 |
|----|-----|
| 模型 | `UVR-MDX-NET-Inst_full_292`（MDX-Net ConvTDFNet，频域 2-stem 伴奏模型） |
| 输出 | **伴奏（instrumental）**；人声由 `原曲 − 伴奏` 得到（与 UVR 一致） |
| 权重文件 | `UVR-MDX-NET-Inst_full_292.onnx` |
| 权重体积 | **66,759,214 字节（≈ 66.8 MB，fp32）**，已实测（HF tree `size` 与下载文件一致） |
| ONNX I/O | 输入 `[batch, 4, 3072, 256]`（实/虚 × 左右声道 STFT）→ 输出同形状 |
| 推理运行时 | `onnxruntime-web`（WASM / WebGPU 后端） |

### 为什么选它

- MDX-Net 是**人声/伴奏专用** 2-stem 模型，只做"拆人声"这一件事，
  人声质量普遍优于把参数分散到 6 轨的 htdemucs_6s（本项目此前实测 6 轨人声偏散）。
- ONNX 图内**无 STFT/DFT op**（STFT 在外部用 JS 实现），全部 8 种 op
  （Conv/ConvTranspose/MatMul/BatchNormalization/Relu/Add/Mul/Transpose）
  均受 onnxruntime-web 1.27 WebGPU 后端支持，已在 M2 上实测 batch=4 推理 0.73× 实时。

### 推理参数（与 UVR 官方一致，spike 逐行核对 `separate.py` / `tfc_tdf_v3.py`）

| 项 | 值 |
|----|-----|
| STFT | `n_fft=6144`，`hop=1024`，hann periodic 窗，`center=True` |
| 输入通道 | 4 = [实L, 虚L, 实R, 虚R]，前 3 个频点清零 |
| 切块 | 每块 `1024×255 = 261120` 采样（≈5.92s @44.1kHz），步长 `(1−0.25)×块长` |
| 拼接 | hanning 窗重叠相加，两端各裁 `n_fft/2 = 3072` |
| batch | 4（模型导出 batch 维度即 4，实测吞吐远优于 batch=1） |

---

## 2. 来源与授权

| 组件 | 来源 | 授权 |
|------|------|------|
| 架构（MDX-Net） | [kuielab/MDX-Net](https://github.com/kuielab/MDX-Net) | **MIT**（见 `public/assets/mdx/licenses/LICENSE-ARCHITECTURE-MIT.txt`） |
| ONNX 导出 | UVR（[Anjok07/ultimatevocalremovergui](https://github.com/Anjok07/ultimatevocalremovergui)，GPL-3.0） | 导出工具本身为 GPL-3.0；本项目仅使用其产出的权重文件，不包含其代码 |
| 权重分发 | [Eddycrack864/UVR5-MDX-NET-VIP-MODELS](https://huggingface.co/Eddycrack864/UVR5-MDX-NET-VIP-MODELS)（HF 社区仓库） | 社区权重，未附带明确商业授权声明 |

**使用限定**：按与 HTDemucs 相同的口径，本项目将 MDX-NET 权重视为
**研究 / 个人使用**用途引入；如要公开发布或商用，需自行向权重发布方确认授权。

---

## 3. 获取方式

```bash
bash scripts/vendor-mdx.sh   # 下载权重到 public/assets/mdx/models/（约 66.8 MB）
```

- 权重不提交进 git（见 `.gitignore`），首次运行时也可由设置页「模型缓存」触发缓存。
- 浏览器侧模型缓存走 `src/os/model-cache.ts` 的 `fetchModelWithCache(MDX_MODEL_URL)`，
  与 HTDemucs / wav2vec2 同一套 CacheStorage 机制。
