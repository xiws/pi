#!/bin/bash

# 获取当前工作目录的绝对路径作为 find 的起点
BASE_DIR=/home/zhong/work/web/pi/packages/coding-agent/docs

# 遍历绝对路径下的所有 markdown 文件，并排除常见 Web 项目特殊目录
find "$BASE_DIR" \
    -name "node_modules" -prune -o \
    -name ".git" -prune -o \
    -name "dist" -prune -o \
    -name "build" -prune -o \
    -name ".next" -prune -o \
    -name "public" -prune -o \
    -name "out" -prune -o \
    -type f -name "*.md" | while read -r file; do

    # 获取文件名（仅用于后缀匹配排除）
    filename=$(basename "$file")

    # 排除以 zh_cn.md, cn.md, zh.md 结尾的文件
    if [[ "$filename" =~ (zh_cn|cn|zh)\.md$ ]]; then
        echo "跳过本地化文件: $file"
        continue
    fi

    # 获取文件的目录路径和不带后缀的纯文件名
    dir_path=$(dirname "$file")
    name_without_ext="${filename%.md}"

    # 构造输出的中文文件名绝对路径：文件名去后缀.zh.md
    output_file="${dir_path}/${name_without_ext}.zh.md"

    echo "=========================================="
    echo "正在处理文件: $file"
    echo "输出目标文件: $output_file"
    echo "=========================================="

    # 使用 cat 将 pi -p 的输出写入新文件
    cat <<EOF > "$output_file"
$(pi -p "markdown document under the $file. translate to chinese")
EOF

    echo "完成处理并已写入: $output_file"
    echo ""
done

echo "所有符合条件的文件处理完毕！"
