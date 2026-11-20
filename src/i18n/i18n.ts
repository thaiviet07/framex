export type Lang = 'vi' | 'en';

const STORAGE_KEY = 'fxh-lang';
let currentLang: Lang = (localStorage.getItem(STORAGE_KEY) as Lang) === 'en' ? 'en' : 'vi';

export const getLang = (): Lang => currentLang;
export function setLang(lang: Lang) {
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
}

const DICT: Record<string, { vi: string; en: string }> = {
  // Topbar
  'side.front': { vi: 'Mặt trước', en: 'Front' },
  'side.back': { vi: 'Mặt sau', en: 'Back' },
  'view.holo': { vi: '3D Holo', en: '3D Holo' },
  'view.flat': { vi: 'Flat Tách bản', en: 'Flat Plates' },
  'top.guides': { vi: 'Guides', en: 'Guides' },
  'top.auto': { vi: 'Auto xoay', en: 'Auto spin' },
  'top.open': { vi: 'Import', en: 'Import' },
  'top.save': { vi: 'Lưu', en: 'Save' },
  'top.new': { vi: '+ Mới', en: '+ New' },
  'top.dup': { vi: 'Nhân bản dự án', en: 'Duplicate project' },
  'top.closeTab': { vi: 'Đóng tab dự án', en: 'Close project tab' },
  'top.newProjTitle': { vi: 'Tạo dự án mới', en: 'New project tab' },
  'top.importTitle': { vi: 'Import file .fxholo vào tab mới', en: 'Import .fxholo as new tab' },
  'top.saveTitle': { vi: 'Lưu dự án hiện tại (.fxholo)', en: 'Save active project (.fxholo)' },
  'top.undo': { vi: 'Hoàn tác (⌘Z)', en: 'Undo (⌘Z)' },
  'top.redo': { vi: 'Làm lại (⇧⌘Z)', en: 'Redo (⇧⌘Z)' },
  'top.projectName': { vi: 'Tên dự án', en: 'Project name' },

  // Tabs
  'tab.artwork': { vi: 'Artwork', en: 'Artwork' },
  'tab.holo': { vi: 'Holo', en: 'Holo' },
  'tab.layers': { vi: 'Layers', en: 'Layers' },
  'tab.masks': { vi: 'Masks', en: 'Masks' },
  'tab.env': { vi: 'HDRI', en: 'HDRI' },
  'tab.specs': { vi: 'Specs', en: 'Specs' },
  'tab.preflight': { vi: 'Preflight', en: 'Preflight' },
  'tab.export': { vi: 'Export', en: 'Export' },

  // Viewport HUD
  'hud.fit': { vi: 'Fit', en: 'Fit' },
  'hud.hint': { vi: 'Cuộn: Zoom • Space+Kéo / Chuột giữa: Pan', en: 'Scroll: Zoom • Space+Drag / Middle: Pan' },

  // Artwork tab
  'art.slotsTitle': { vi: 'Ảnh thẻ & Holo (kéo thả hoặc click)', en: 'Card & Holo Assets (drag or click)' },
  'art.downloadRef': { vi: 'Tải bộ ảnh mẫu', en: 'Download references' },
  'art.resetDefault': { vi: 'Reset mặc định', en: 'Reset defaults' },
  'art.fitTitle': { vi: 'Khớp khổ (Bleed / Trim)', en: 'Artwork Fit (Bleed / Trim)' },
  'art.fitFront': { vi: 'Artwork Mặt trước', en: 'Front Artwork' },
  'art.fitBack': { vi: 'Artwork Mặt sau', en: 'Back Artwork' },
  'art.fitAuto': { vi: 'Auto (tự nhận diện)', en: 'Auto detect' },
  'art.fitBleed': { vi: 'Phủ Bleed', en: 'Fill Bleed' },
  'art.fitTrim': { vi: 'Vừa Trim', en: 'Fit Trim' },
  'art.holoSection': { vi: 'Holo Pattern (Mặt trước)', en: 'Holo Pattern (Front)' },
  'art.enableHolo': { vi: 'Bật Holo', en: 'Enable Holo' },
  'art.openHoloDeep': { vi: 'Mở cấu hình sâu Holo →', en: 'Open Deep Holo Studio →' },

  // Holo tab
  'holo.stackTitle': { vi: 'Multi Holo Layers (mỗi layer 1 mask riêng)', en: 'Multi Holo Layers (independent masks)' },
  'holo.addLayer': { vi: '+ Thêm Holo Layer', en: '+ Add Holo Layer' },
  'holo.layerName': { vi: 'Tên Holo Layer', en: 'Holo Layer Name' },
  'holo.foilTex': { vi: 'Ảnh Foil tùy chỉnh cho layer này', en: 'Custom Foil Texture (this layer)' },
  'holo.sec1': { vi: '1. Quang học & Pattern Holo', en: '1. Holo Optics & Pattern' },
  'holo.sec2': { vi: '2. Cách Holo Tương Tác & Vật lý', en: '2. Holo Interaction & Physics' },
  'holo.sec3': { vi: '3. Quản lý Holo Mask & Phạm vi', en: '3. Holo Masking & Scope' },
  'holo.reset': { vi: 'Reset', en: 'Reset' },
  'holo.on': { vi: 'Bật', en: 'On' },
  'holo.preset': { vi: 'Preset Holo (31 mẫu)', en: 'Holo Preset (31 styles)' },
  'holo.shine': { vi: 'Cường độ Shine', en: 'Shine Intensity' },
  'holo.glare': { vi: 'Cường độ Glare', en: 'Glare Intensity' },
  'holo.angle': { vi: 'Góc vân cầu vồng', en: 'Rainbow Angle' },
  'holo.space': { vi: 'Mật độ dải màu', en: 'Rainbow Spacing' },
  'holo.scanline': { vi: 'Bước vân gạch dọc', en: 'Vertical Scanline Pitch' },
  'holo.glitter': { vi: 'Kích thước hạt Glitter', en: 'Glitter Scale' },
  'holo.hue': { vi: 'Xoay sắc màu (Hue)', en: 'Hue Shift' },
  'holo.sat': { vi: 'Độ rực (Sat)', en: 'Saturation' },
  'holo.bright': { vi: 'Độ sáng', en: 'Brightness' },
  'holo.contrast': { vi: 'Tương phản', en: 'Contrast' },
  'holo.blend': { vi: 'Blend Mode', en: 'Blend Mode' },
  'holo.mode': { vi: 'Chế độ tương tác', en: 'Interaction Mode' },
  'holo.mode.pa': { vi: 'Chuột + Tự xoay', en: 'Pointer + Auto' },
  'holo.mode.p': { vi: 'Chỉ theo chuột', en: 'Pointer Only' },
  'holo.mode.a': { vi: 'Chỉ tự xoay', en: 'Auto Only' },
  'holo.mode.m': { vi: 'Khóa góc thủ công', en: 'Manual Lock' },
  'holo.pattern': { vi: 'Quỹ đạo tự xoay', en: 'Auto Trajectory' },
  'holo.pat.orbit': { vi: 'Vòng tròn (Orbit)', en: 'Orbit' },
  'holo.pat.fig8': { vi: 'Số 8 (Figure-8)', en: 'Figure-8' },
  'holo.pat.sx': { vi: 'Quét ngang (L ↔ R)', en: 'Horizontal Sweep' },
  'holo.pat.sy': { vi: 'Quét dọc (T ↕ B)', en: 'Vertical Sweep' },
  'holo.manX': { vi: 'Góc nghiêng X', en: 'Tilt X' },
  'holo.manY': { vi: 'Góc nghiêng Y', en: 'Tilt Y' },
  'holo.lightX': { vi: 'Nguồn sáng X', en: 'Light X' },
  'holo.lightY': { vi: 'Nguồn sáng Y', en: 'Light Y' },
  'holo.amp': { vi: 'Biên độ tự xoay', en: 'Auto Amplitude' },
  'holo.freq': { vi: 'Tốc độ tự xoay', en: 'Auto Speed' },
  'holo.sens': { vi: 'Độ nhạy chuột', en: 'Pointer Sensitivity' },
  'holo.parallax': { vi: 'Parallax nền Holo', en: 'Holo Parallax' },
  'holo.stiff': { vi: 'Độ cứng lò xo', en: 'Spring Stiffness' },
  'holo.damp': { vi: 'Giảm chấn (Damp)', en: 'Spring Damping' },
  'holo.restGlow': { vi: 'Độ sáng khi nghỉ', en: 'Resting Glow' },
  'holo.invertTilt': { vi: 'Đảo chiều nghiêng theo chuột (Invert Tilt)', en: 'Invert Tilt Axis' },
  'holo.scope': { vi: 'Phạm vi áp dụng Mask', en: 'Mask Scope' },
  'holo.scope.shine': { vi: 'Chỉ lớp Holo Shine (chuẩn Pokémon)', en: 'Holo Shine Only (Standard)' },
  'holo.scope.sg': { vi: 'Holo Shine + Ánh lóa (Glare)', en: 'Holo Shine + Glare' },
  'holo.scope.all': { vi: 'Toàn bộ hiệu ứng (Shine + Glare + Glitter)', en: 'All Effects (Shine + Glare + Glitter)' },
  'holo.scope.none': { vi: 'Bỏ qua Mask (Phủ toàn thẻ)', en: 'Bypass Mask (Full Card)' },
  'holo.choke': { vi: 'Choke / Spread', en: 'Choke / Spread' },
  'holo.feather': { vi: 'Làm mềm viền (Feather)', en: 'Edge Feather' },
  'holo.invertMask': { vi: 'Đảo ngược vùng Holo (Invert: nhân vật ↔ nền)', en: 'Invert Holo Mask (Subject ↔ Background)' },
  'holo.previewMask': { vi: 'Hiện lớp phủ vùng Mask Holo trên thẻ 3D', en: 'Show Holo Mask Overlay on 3D Card' },
  'holo.exportPlate': { vi: 'Xuất Holo Mask thành bản in (Spot: HoloFoil)', en: 'Export Holo Mask as Plate (Spot: HoloFoil)' },
  'holo.uploadMask': { vi: '+ Tải Mask', en: '+ Upload Mask' },
  'holo.fromFront': { vi: '+ Tạo từ Front', en: '+ From Front' },
  'holo.assignMask': { vi: '+ Gán Mask', en: '+ Assign Mask' },
  'holo.noMasks': { vi: 'Chưa gắn mask cho Holo (hiệu ứng phủ toàn thẻ).', en: 'No masks assigned to Holo (full card).' },

  // Layers tab (Photoshop-style)
  'layers.addTitle': { vi: 'Thêm Layer kỹ thuật in', en: 'Add Printing Technique Layer' },
  'layers.stackTitle': { vi: 'Layers (kéo thả để đổi thứ tự)', en: 'Layers (drag to reorder)' },
  'layers.empty': { vi: 'Chưa có layer nào ở mặt này. Chọn một kỹ thuật ở trên để thêm.', en: 'No layers on this side yet. Pick a technique above to add.' },
  'layers.soloExit': { vi: 'Đang Solo 1 layer — bấm S để hiện lại', en: 'Solo active — click S to restore' },
  'layers.props': { vi: 'Thuộc tính Layer', en: 'Layer Properties' },
  'layers.plateName': { vi: 'Tên bản in (Plate)', en: 'Plate Name' },
  'layers.opacity': { vi: 'Độ mờ (Opacity)', en: 'Opacity' },
  'layers.trapping': { vi: 'Choke / Spread (Trapping)', en: 'Choke / Spread (Trapping)' },
  'layers.invert': { vi: 'Đảo ngược vùng mask của layer này', en: 'Invert layer mask' },
  'layers.maskOverlay': { vi: 'Hiện lớp phủ vùng Mask trên thẻ 3D & 2D', en: 'Show Layer Mask Overlay on 3D & 2D' },
  'layers.maskStack': { vi: 'Kết hợp Mask (Boolean)', en: 'Mask Stack (Boolean)' },
  'layers.addMask': { vi: '+ Thêm mask', en: '+ Add mask' },
  'layers.noMask': { vi: 'Chưa gắn mask nào. Bấm "+ Thêm mask" để gán.', en: 'No masks assigned. Click "+ Add mask".' },
  'layers.lockedHint': { vi: 'Layer đang khóa — mở khóa 🔒 để chỉnh sửa.', en: 'Layer is locked — unlock 🔒 to edit.' },
  'layers.dup': { vi: 'Nhân bản', en: 'Duplicate' },
  'layers.del': { vi: 'Xóa', en: 'Delete' },
  'layers.solo': { vi: 'Solo layer này', en: 'Solo layer' },
  'layers.lock': { vi: 'Khóa / Mở khóa', en: 'Lock / Unlock' },
  'layers.vis': { vi: 'Ẩn / Hiện', en: 'Show / Hide' },
  'layers.dblRename': { vi: 'Double-click để đổi tên', en: 'Double-click to rename' },

  // Masks tab
  'masks.createTitle': { vi: 'Tạo / Tải Mask dùng chung', en: 'Create / Upload Shared Mask' },
  'masks.upload': { vi: '+ Tải ảnh Mask', en: '+ Upload Mask' },
  'masks.fromArt': { vi: '+ Từ Artwork', en: '+ From Artwork' },
  'masks.solid': { vi: '+ Solid', en: '+ Solid' },
  'masks.libTitle': { vi: 'Thư viện Mask', en: 'Mask Library' },
  'masks.editTitle': { vi: 'Hiệu chỉnh Mask', en: 'Mask Inspector' },
  'masks.name': { vi: 'Tên mask', en: 'Mask Name' },
  'masks.mode': { vi: 'Chế độ trích xuất', en: 'Extraction Mode' },
  'masks.fit': { vi: 'Khớp khổ', en: 'Fit Mode' },
  'masks.pickColor': { vi: 'Màu chọn:', en: 'Target color:' },
  'masks.threshold': { vi: 'Bật ngưỡng nhị phân (Threshold 1-bit)', en: 'Enable Binary Threshold (1-bit)' },
  'masks.thresholdVal': { vi: 'Ngưỡng (Threshold)', en: 'Threshold' },
  'masks.invert': { vi: 'Đảo ngược Mask (Invert)', en: 'Invert Mask' },

  // Env / HDRI tab
  'env.presetsTitle': { vi: 'Môi trường ánh sáng HDRI (7 Preset)', en: 'HDRI Lighting Environments (7 Presets)' },
  'env.customTitle': { vi: 'Tải ảnh HDRI / Panorama tùy chỉnh', en: 'Custom HDRI / Panorama Map' },
  'env.uploadBtn': { vi: '+ Tải ảnh HDRI (JPG / PNG / WebP)', en: '+ Upload HDRI Image (JPG / PNG / WebP)' },
  'env.clearCustom': { vi: 'Dùng Preset mặc định', en: 'Use Built-in Preset' },
  'env.customActive': { vi: 'Đang dùng ảnh HDRI tùy chỉnh', en: 'Custom HDRI map active' },
  'env.customHint': { vi: 'Hỗ trợ ảnh panorama 360° (Equirectangular 2:1) hoặc bất kỳ ảnh môi trường nào để tạo phản xạ lên Foil, Spot UV, Emboss & nền Stage.', en: 'Supports 360° equirectangular panoramas (2:1) or any environment photo to drive Foil, Spot UV, Emboss reflections & stage backdrop.' },
  'env.lightTitle': { vi: 'Tinh chỉnh ánh sáng & góc phản xạ', en: 'Lighting & Reflection Controls' },
  'env.rotation': { vi: 'Xoay môi trường (Rotation)', en: 'Environment Rotation' },
  'env.exposure': { vi: 'Cường độ sáng (Exposure)', en: 'Exposure' },
  'env.temperature': { vi: 'Nhiệt độ màu (Lạnh ↔ Ấm)', en: 'Color Temperature (Cool ↔ Warm)' },
  'env.elevation': { vi: 'Độ cao đèn (Elevation)', en: 'Light Elevation' },
  'env.backdropTitle': { vi: 'Nền không gian 3D (Stage Backdrop)', en: '3D Stage Backdrop' },
  'env.showBackdrop': { vi: 'Hiện nền HDRI phía sau thẻ 3D', en: 'Show HDRI Backdrop behind 3D Card' },
  'env.backdropBlur': { vi: 'Độ mờ nền (Blur)', en: 'Backdrop Blur' },
  'env.backdropDim': { vi: 'Độ sáng nền (Brightness)', en: 'Backdrop Brightness' },
  'env.reset': { vi: 'Reset HDRI', en: 'Reset HDRI' },

  // Specs tab
  'specs.sizeTitle': { vi: 'Khổ thẻ & Đơn vị', en: 'Card Dimensions & Units' },
  'specs.preset': { vi: 'Preset khổ thẻ', en: 'Card Size Preset' },
  'specs.unit': { vi: 'Đơn vị hiển thị:', en: 'Display unit:' },
  'specs.width': { vi: 'Chiều rộng (Trim)', en: 'Trim Width' },
  'specs.height': { vi: 'Chiều cao (Trim)', en: 'Trim Height' },
  'specs.bleed': { vi: 'Bleed (tràn lề)', en: 'Bleed' },
  'specs.safe': { vi: 'Safe Zone', en: 'Safe Zone' },
  'specs.corner': { vi: 'Bo góc (Corner R)', en: 'Corner Radius' },
  'specs.substrate': { vi: 'Chất liệu nền', en: 'Substrate' },
  'specs.subWhite': { vi: 'Giấy trắng (White)', en: 'White Cardstock' },
  'specs.subMetal': { vi: 'Nền Metallic / Foil', en: 'Metallic / Foil Stock' },
  'specs.totalBleed': { vi: 'Tổng khổ cả bleed:', en: 'Full bleed size:' },
  'specs.dpiTitle': { vi: 'Độ phân giải & Ngưỡng Preflight', en: 'Resolution & Preflight Thresholds' },
  'specs.artDpi': { vi: 'Artwork DPI', en: 'Artwork DPI' },
  'specs.plateDpi': { vi: 'Plate DPI (Foil/Emboss)', en: 'Plate DPI (Foil/Emboss)' },
  'specs.minFoil': { vi: 'Nét Foil tối thiểu (mm)', en: 'Min Foil Line (mm)' },
  'specs.minEmboss': { vi: 'Nét Emboss tối thiểu (mm)', en: 'Min Emboss Line (mm)' },

  // Preflight tab
  'pf.title': { vi: 'Kiểm tra tiền in (Preflight)', en: 'Pre-press Preflight Check' },
  'pf.run': { vi: 'Chạy kiểm tra Preflight', en: 'Run Preflight Check' },
  'pf.summary': { vi: 'Kết quả: {e} lỗi • {w} cảnh báo (bấm để xem vị trí)', en: 'Result: {e} errors • {w} warnings (click to inspect)' },

  // Export tab
  'exp.title': { vi: 'Gói file sản xuất TCG (.zip) — Spec tiếng Anh', en: 'TCG Production Package (.zip) — English Specs' },
  'exp.pdf': { vi: 'print_ready.pdf (TrimBox, BleedBox, Spot Colors, CutContour)', en: 'print_ready.pdf (TrimBox, BleedBox, Spot Colors, CutContour)' },
  'exp.tiffs': { vi: 'File TIFF từng mặt ({a} DPI) & từng plate ({p} DPI)', en: 'Artwork TIFFs ({a} DPI) & Plate TIFFs ({p} DPI)' },
  'exp.holo': { vi: 'Holo Pattern & Holo Mask (HoloPattern.tif, HoloMask.tif, foil gốc & PDF Spot)', en: 'Holo Pattern & Holo Mask (HoloPattern.tif, HoloMask.tif, foil source & PDF Spot)' },
  'exp.dieline': { vi: 'dieline.svg (đường cắt chuẩn mm)', en: 'dieline.svg (exact mm cut path)' },
  'exp.mockup': { vi: 'preview_mockup_3d_1080p.mp4 (Full HD 10s, 2 loop, đủ góc tilt) + preview_mockup.png', en: 'preview_mockup_3d_1080p.mp4 (Full HD 10s, 2 loops, all tilt angles) + preview_mockup.png' },
  'exp.spec': { vi: 'spec_sheet.pdf + spec.json (luôn xuất bằng tiếng Anh)', en: 'spec_sheet.pdf + spec.json (always English)' },
  'exp.btn': { vi: 'Xuất gói sản xuất (.zip)', en: 'Export Production ZIP' },
  'exp.videoBtn': { vi: 'Xuất riêng Video 3D Full HD (.mp4 • 10s • 2 loop)', en: 'Export 3D Proof Video (.mp4 • 1080p • 10s • 2 loops)' },
  'exp.busy': { vi: 'Đang xuất file...', en: 'Exporting...' },
  'exp.projTitle': { vi: 'File dự án nội bộ (.fxholo)', en: 'Internal Project File (.fxholo)' },
  'exp.saveProj': { vi: 'Lưu .fxholo', en: 'Save .fxholo' },
  'exp.openProj': { vi: 'Mở .fxholo', en: 'Open .fxholo' },

  // Misc
  'slider.resetTitle': { vi: 'Đặt lại mặc định ({v})', en: 'Reset to default ({v})' },
  'flat.artwork': { vi: 'Artwork', en: 'Artwork' },
};

export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = DICT[key];
  let str = entry ? entry[currentLang] : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, String(v));
  }
  return str;
}
