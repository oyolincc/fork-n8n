#!/usr/bin/env bash

set -e

cur_datetime=$(date +%Y-%m-%d-%H-%M-%S)

BASE_DIR="save"
TARGET_DIR="${BASE_DIR}/${cur_datetime}"
# 镜像文件路径
IMAGE_FILE="${TARGET_DIR}/images.tar.gz"
IMAGE_TARGETS="n8nio/n8n:local"
# 最终产出包路径
FINAL_PACKAGE="${BASE_DIR}/${cur_datetime}.tar"

echo "========================================"
echo "开始打包任务: ${cur_datetime}"
echo "========================================"

# ================= 2. 创建目录 =================
echo "[1/5] 创建目录..."
mkdir -p "$TARGET_DIR"

# ================= 3. 导出镜像 =================
echo "[2/5] 导出 Docker 镜像..."
echo "      文件位置: ${IMAGE_FILE}"

# 检查 Docker 运行状态
if ! docker info > /dev/null 2>&1; then
    echo "❌ 错误: Docker 未运行，脚本终止。"
    # 失败时清理已创建的空目录 (可选)
    rmdir "$TARGET_DIR" 2>/dev/null || true
    exit 1
fi

docker save ${IMAGE_TARGETS} | gzip > "$IMAGE_FILE"

# ================= 4. 拷贝配置文件 =================
echo "[3/5] 拷贝配置文件..."

FILES_TO_COPY=(
    "./.env"
    "./up.sh"
    "./down.sh"
    "./compose.yml"
)

for file in "${FILES_TO_COPY[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" "$TARGET_DIR/"
    else
        echo "      ⚠️ 警告: 文件不存在 -> $file"
    fi
done

# ================= 5. 打包 =================
echo "[4/5] 生成传输包..."
# -C 切换目录，保证包内结构干净
tar -cf "$FINAL_PACKAGE" -C "$BASE_DIR" "$cur_datetime"
echo "      包已生成: ${FINAL_PACKAGE}"

# ================= 6. 安全清理 (保险栓逻辑) =================
echo "[5/5] 清理临时目录..."

# --- 安全检查开始 ---

# 1. 变量强制检查：如果 TARGET_DIR 为空，脚本会在此处报错并退出，不会执行 rm
: "${TARGET_DIR:?错误: 待删除的目录变量为空，为了安全已终止脚本。}"

# 2. 根目录/系统目录保护：防止变量被赋值为 / 或 .
if [[ "$TARGET_DIR" == "/" || "$TARGET_DIR" == "." || "$TARGET_DIR" == ".." ]]; then
    echo "❌ 危险: 试图删除系统根目录或当前目录 ($TARGET_DIR)，操作已拦截！"
    exit 1
fi

# 3. 路径特征检查（可选）：确保路径确实是在 save/ 下（双重保险）
# 使用 grep 检查变量是否以 save/ 开头，或者包含 save/
if [[ "$TARGET_DIR" != "${BASE_DIR}/"* ]]; then
     echo "❌ 危险: 待删除目录不在 ${BASE_DIR} 范围内，操作已拦截！"
     exit 1
fi

# 4. 目录存在性检查
if [ ! -d "$TARGET_DIR" ]; then
    echo "⚠️ 目录不存在，无需删除: $TARGET_DIR"
else
    # 只有通过以上所有检查，才执行删除
    rm -rf "$TARGET_DIR"
    echo "✅ 临时目录已安全删除。"
fi
# --- 安全检查结束 ---

echo "========================================"
echo "🎉 脚本执行成功！"
echo "========================================"