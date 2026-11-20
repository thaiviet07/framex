# FramigosX Holo Studio 2.0 — TCG Pre-press

Công cụ thiết kế, mô phỏng 3D và chuẩn bị file in (pre-press) cho thẻ TCG/Sports dành cho nội bộ **FramigosX**, chạy 100% client-side (không gửi ảnh ra ngoài).

## Tính năng chính
- **Kiến trúc Vite + TypeScript + Web Worker + WebGL**:
  - Xử lý ảnh, mask, morphology (choke/spread), blur và phân tích preflight hoàn toàn trên **Web Worker** (không đứng UI khi tải ảnh 600 DPI).
  - **WebGL Compositor** mô phỏng ánh sáng vật lý theo góc nghiêng cho cả **mặt trước** và **mặt sau**, kết hợp mượt với **31 preset Holo CSS** (`pokemon-cards-css` & `pokemon-cards-151`).
  - Tự động lưu phiên làm việc vào **IndexedDB** + hỗ trợ **Undo/Redo** (`⌘Z` / `⇧⌘Z`) và lưu/mở file dự án **`.fxholo`**.
- **Hệ thống đa Layer & Kỹ thuật in (8 loại plate)**:
  - `Hot Foil` (Gold, Silver, Rose Gold, Copper, Holographic, Rainbow, Black Gloss — chỉnh roughness, brightness)
  - `Cold Foil` (in đè màu CMYK lên nền foil bạc)
  - `Spot UV` (chỉnh độ bóng + Raised UV `µm`)
  - `Matte / Soft-touch Varnish`
  - `Emboss` (dập nổi — chỉnh độ sâu `mm`, bevel `mm`, single/multi/sculpted)
  - `Deboss` (dập chìm)
  - `Texture` (Sandpaper, Linen, Etched lines, Carbon, Dots)
  - `White Ink / Underbase` (cho nền Metallic)
- **Thư viện Mask dùng chung & Boolean**:
  - Tải ảnh mask, tự tạo từ Artwork (`Luminance`, `Alpha`, `Color Range` chọn màu + tolerance/softness) hoặc `Solid`.
  - Kết hợp nhiều mask trên cùng một layer bằng phép toán **Union (+), Subtract (−), Intersect (∩), XOR (⊕)**.
  - Chỉnh **Levels**, **Threshold 1-bit**, **Feather (mm)**, **Choke/Spread (mm)** (trapping) và **Invert**.
- **Thông số vật lý & Chế độ xem Flat Tách bản**:
  - Khổ chuẩn mặc định **Sports / TCG 2.5″ × 3.5″ (63.5 × 88.9 mm)**, **bo góc vuông 0 mm**, Bleed `3 mm`, Safe Zone `3 mm`, chuyển đổi `mm / in / px`.
  - Chế độ **Flat Tách bản** hiển thị Bleed, Trim, Safe Zone, Crop Marks và lớp phủ màu từng bản in (bật/tắt từng plate).
- **Preflight tự động**:
  - Kiểm tra DPI thực tế, độ phủ bleed, nét mảnh dưới ngưỡng cho Foil/Emboss, vùng chạm mép cắt (ngoài Safe Zone) và xung đột Emboss/Deboss. Bấm vào cảnh báo để phóng tới đúng vị trí trên bản Flat.
- **Xuất gói sản xuất TCG (`.zip`)**:
  - `print_ready.pdf`: Đa trang (Front, Back, `CutContour` Die-line, và từng trang **Spot Color /Separation** cho từng plate) kèm TrimBox, BleedBox, Crop Marks, Registration Marks, Color Bar và Slug.
  - `front_artwork.tif`, `back_artwork.tif` (`300 DPI`) và `plates/plate_*.tif` (`600/1200 DPI`) có nhúng tag DPI chuẩn.
  - `dieline.svg`, `preview_mockup.png`, `spec_sheet.pdf` (phiếu kỹ thuật cho nhà in), và `spec.json`.

## Chạy & Build
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # Build bản production vào dist/
npm run preview  # Xem trước bản production
```

## Phím tắt
- `⌘Z` / `Ctrl+Z`: Hoàn tác • `⇧⌘Z` / `Ctrl+Y`: Làm lại
- `F`: Lật Mặt trước / Mặt sau
- `G`: Bật / tắt Guides (Trim & Safe Zone)
- `Esc`: Đóng chế độ phóng to thẻ

## Giấy phép
Kế thừa hiệu ứng CSS và logic tương tác từ [simeydotme/pokemon-cards-css](https://github.com/simeydotme/pokemon-cards-css), [simeydotme/pokemon-cards-151](https://github.com/simeydotme/pokemon-cards-151) và [fyk0620/ribi-holo](https://github.com/fyk0620/ribi-holo) (GPL-3.0). Xem `public/licenses/` và `LICENSE`.
