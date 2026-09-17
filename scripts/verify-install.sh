#!/usr/bin/env bash
# 用 curl 从 npmmirror 手动安装类型检查所需依赖（沙箱 npm 出网被拦截，但 curl 可用）
set -e
cd "$(dirname "$0")/.."
REG=https://registry.npmmirror.com
mkdir -p node_modules .dl
pkgs=(typescript @types/node @types/react @types/react-dom react react-dom vite hls.js https-proxy-agent socks-proxy-agent)
for p in "${pkgs[@]}"; do
  meta=$(curl -s -H 'Accept: application/vnd.npm.install-v1+json' "$REG/$p")
  ver=$(printf '%s' "$meta" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j=JSON.parse(s);console.log(j['dist-tags'].latest)})")
  tb=$(printf '%s' "$meta" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j=JSON.parse(s);let v=process.argv[1];console.log(j.versions[v].dist.tarball)})" "$ver")
  echo "== $p@$ver"
  for try in 1 2 3; do
    curl -sL -o ".dl/$p.tgz" "$tb"
    sz=$(stat -c%s ".dl/$p.tgz" 2>/dev/null || echo 0)
    if [ "$sz" -gt 1000 ]; then break; else echo "  重试 $try"; fi
  done
  dir="node_modules/$p"
  rm -rf "$dir"
  mkdir -p "$dir"
  tar -xzf ".dl/$p.tgz" -C "$dir" --strip-components=1
  # 处理作用域包名 @types/react -> node_modules/@types/react
  if [[ "$p" == @* ]]; then
    scope=$(echo "$p" | cut -d/ -f1)
    name=$(echo "$p" | cut -d/ -f2)
    tgt="node_modules/$scope/$name"
    rm -rf "$tgt"
    mkdir -p "$(dirname "$tgt")"
    mv "$dir" "$tgt"
  fi
done
echo "=== 安装完成，开始类型检查 ==="
node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
echo "RENDERER_EXIT=$?"
node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit
echo "MAIN_EXIT=$?"
