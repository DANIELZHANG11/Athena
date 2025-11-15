const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..', 'src')
const files = []
function collect(dir){
  for(const f of fs.readdirSync(dir)){
    const p = path.join(dir, f)
    const s = fs.statSync(p)
    if(s.isDirectory()) collect(p)
    else if(/\.(ts|tsx)$/.test(f)) files.push(p)
  }
}
collect(root)
let failed = false
for(const f of files){
  const c = fs.readFileSync(f,'utf8')
  const badZh = c.match(/['"`][^'"`]*[\u4e00-\u9fff][^'"`]*['"`]/g)
  if(badZh){
    for(const m of badZh){
      if(!/t\(["'][^"']+["']\)/.test(c)){
        console.error(`Hardcoded string in ${f}: ${m}`)
        failed = true
      }
    }
  }
}
if(failed){
  process.exit(1)
}
