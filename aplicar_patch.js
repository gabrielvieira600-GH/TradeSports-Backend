const fs=require('fs'),path=require('path');
const target=path.join(process.cwd(),'routes','api','admin.js');const source=path.join(__dirname,'clubManagementRoutes.js');
if(!fs.existsSync(target)||!fs.existsSync(source))throw Error('Execute na raiz do backend e copie os dois arquivos da pasta backend.');
let s=fs.readFileSync(target,'utf8');const marker='// TRADE SPORTS CLUB MANAGEMENT V1';
if(s.includes(marker)){console.log('Rotas já instaladas.');process.exit(0)}
const anchor='router.use(isAdmin);';if(!s.includes(anchor))throw Error('Ponto de inserção admin não encontrado; nenhum arquivo alterado.');
fs.copyFileSync(target,target+'.bak-club-management');
s=s.replace(anchor,anchor+'\n\n'+marker+'\nrouter.use(\'/club-management\', require(\'./clubManagementRoutes\'));');
fs.writeFileSync(target,s);fs.copyFileSync(source,path.join(process.cwd(),'routes','api','clubManagementRoutes.js'));console.log('Backend instalado. Backup: admin.js.bak-club-management');
