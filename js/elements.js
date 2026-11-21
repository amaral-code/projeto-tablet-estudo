// Tabela periódica: os 118 elementos (símbolo, nome em português e massa atômica em u).
// A posição na tabela é calculada pelo número atômico.
const RAW = 'H Hidrogênio 1.008|He Hélio 4.0026|Li Lítio 6.94|Be Berílio 9.0122|B Boro 10.81|C Carbono 12.011|N Nitrogênio 14.007|O Oxigênio 15.999|F Flúor 18.998|Ne Neônio 20.180|'
  + 'Na Sódio 22.990|Mg Magnésio 24.305|Al Alumínio 26.982|Si Silício 28.085|P Fósforo 30.974|S Enxofre 32.06|Cl Cloro 35.45|Ar Argônio 39.948|K Potássio 39.098|Ca Cálcio 40.078|'
  + 'Sc Escândio 44.956|Ti Titânio 47.867|V Vanádio 50.942|Cr Cromo 51.996|Mn Manganês 54.938|Fe Ferro 55.845|Co Cobalto 58.933|Ni Níquel 58.693|Cu Cobre 63.546|Zn Zinco 65.38|'
  + 'Ga Gálio 69.723|Ge Germânio 72.630|As Arsênio 74.922|Se Selênio 78.971|Br Bromo 79.904|Kr Criptônio 83.798|Rb Rubídio 85.468|Sr Estrôncio 87.62|Y Ítrio 88.906|Zr Zircônio 91.224|'
  + 'Nb Nióbio 92.906|Mo Molibdênio 95.95|Tc Tecnécio (98)|Ru Rutênio 101.07|Rh Ródio 102.91|Pd Paládio 106.42|Ag Prata 107.87|Cd Cádmio 112.41|In Índio 114.82|Sn Estanho 118.71|'
  + 'Sb Antimônio 121.76|Te Telúrio 127.60|I Iodo 126.90|Xe Xenônio 131.29|Cs Césio 132.91|Ba Bário 137.33|La Lantânio 138.91|Ce Cério 140.12|Pr Praseodímio 140.91|Nd Neodímio 144.24|'
  + 'Pm Promécio (145)|Sm Samário 150.36|Eu Európio 151.96|Gd Gadolínio 157.25|Tb Térbio 158.93|Dy Disprósio 162.50|Ho Hólmio 164.93|Er Érbio 167.26|Tm Túlio 168.93|Yb Itérbio 173.05|'
  + 'Lu Lutécio 174.97|Hf Háfnio 178.49|Ta Tântalo 180.95|W Tungstênio 183.84|Re Rênio 186.21|Os Ósmio 190.23|Ir Irídio 192.22|Pt Platina 195.08|Au Ouro 196.97|Hg Mercúrio 200.59|'
  + 'Tl Tálio 204.38|Pb Chumbo 207.2|Bi Bismuto 208.98|Po Polônio (209)|At Astato (210)|Rn Radônio (222)|Fr Frâncio (223)|Ra Rádio (226)|Ac Actínio (227)|Th Tório 232.04|'
  + 'Pa Protactínio 231.04|U Urânio 238.03|Np Netúnio (237)|Pu Plutônio (244)|Am Amerício (243)|Cm Cúrio (247)|Bk Berquélio (247)|Cf Califórnio (251)|Es Einstênio (252)|Fm Férmio (257)|'
  + 'Md Mendelévio (258)|No Nobélio (259)|Lr Laurêncio (266)|Rf Rutherfórdio (267)|Db Dúbnio (268)|Sg Seabórgio (269)|Bh Bóhrio (270)|Hs Hássio (277)|Mt Meitnério (278)|Ds Darmstácio (281)|'
  + 'Rg Roentgênio (282)|Cn Copernício (285)|Nh Nihônio (286)|Fl Fleróvio (289)|Mc Moscóvio (290)|Lv Livermório (293)|Ts Tenessino (294)|Og Oganessônio (294)';

export const CATS = {
  alcalino: ['Metal alcalino', '#ff8a80'], alcalinoterroso: ['Metal alcalinoterroso', '#ffcc80'], transicao: ['Metal de transição', '#ffe082'],
  representativo: ['Outro metal', '#c5e1a5'], semimetal: ['Semimetal', '#80cbc4'], ametal: ['Ametal', '#81d4fa'], halogenio: ['Halogênio', '#b39ddb'],
  nobre: ['Gás nobre', '#f48fb1'], lantanideo: ['Lantanídeo', '#bcaaa4'], actinideo: ['Actinídeo', '#cfd8dc'],
};
const inSet = (z, list) => list.includes(z);
export function categoryOf(z) {
  if (inSet(z, [3, 11, 19, 37, 55, 87])) return 'alcalino';
  if (inSet(z, [4, 12, 20, 38, 56, 88])) return 'alcalinoterroso';
  if (z >= 57 && z <= 71) return 'lantanideo';
  if (z >= 89 && z <= 103) return 'actinideo';
  if ((z >= 21 && z <= 30) || (z >= 39 && z <= 48) || (z >= 72 && z <= 80) || (z >= 104 && z <= 112)) return 'transicao';
  if (inSet(z, [5, 14, 32, 33, 51, 52])) return 'semimetal';
  if (inSet(z, [1, 6, 7, 8, 15, 16, 34])) return 'ametal';
  if (inSet(z, [9, 17, 35, 53, 85, 117])) return 'halogenio';
  if (inSet(z, [2, 10, 18, 36, 54, 86, 118])) return 'nobre';
  return 'representativo';
}
// linha e coluna na tabela (linhas 9 e 10 = lantanídeos e actinídeos, separados embaixo)
export function positionOf(z) {
  if (z === 1) return [1, 1];
  if (z === 2) return [1, 18];
  const P = [[3, 10, 2], [11, 18, 3], [19, 36, 4], [37, 54, 5]];
  for (const [a, b, row] of P) if (z >= a && z <= b) {
    const n = z - a;
    if (b - a === 7) return [row, n < 2 ? n + 1 : n + 11];
    return [row, n + 1];
  }
  if (z <= 56) return [6, z - 54];
  if (z <= 71) return [9, z - 57 + 3];
  if (z <= 86) return [6, z - 72 + 4];
  if (z <= 88) return [7, z - 86];
  if (z <= 103) return [10, z - 89 + 3];
  return [7, z - 104 + 4];
}
export const ELEMENTS = RAW.split('|').map((s, i) => {
  const [sym, name, mass] = s.split(' ');
  const z = i + 1, [row, col] = positionOf(z);
  const synthetic = mass.startsWith('(');
  const m = parseFloat(mass.replace(/[()]/g, ''));
  return { z, sym, name, mass: m, massText: mass, synthetic, cat: categoryOf(z), row, col, period: row <= 7 ? row : row === 9 ? 6 : 7, group: row <= 7 ? col : 3 };
});
// distribuição eletrônica por camadas (Linus Pauling, ordem de energia)
const ORDER = ['1s', '2s', '2p', '3s', '3p', '4s', '3d', '4p', '5s', '4d', '5p', '6s', '4f', '5d', '6p', '7s', '5f', '6d', '7p'];
const CAP = { s: 2, p: 6, d: 10, f: 14 };
export function electronConfig(z) {
  let left = z; const out = [];
  for (const o of ORDER) { if (!left) break; const n = Math.min(CAP[o[1]], left); out.push(`${o}${n}`); left -= n; }
  return out.join(' ');
}
export function shells(z) {
  const k = {};
  for (const part of electronConfig(z).split(' ')) { const n = +part[0], e = +part.slice(2); k[n] = (k[n] || 0) + e; }
  return Object.keys(k).sort().map(n => k[n]);
}
export const findElement = q => {
  const s = String(q).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!s) return null;
  return ELEMENTS.find(e => e.sym.toLowerCase() === s) || ELEMENTS.find(e => String(e.z) === s) || ELEMENTS.find(e => e.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith(s)) || null;
};
