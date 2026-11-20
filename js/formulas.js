// Fórmulas de matemática e física: busque pelo nome ("área do círculo", "fórmula da força"),
// veja a fórmula certa e preencha os números — o app calcula sozinho o valor que ficou em branco.
import { ic, esc, toast } from './ui.js';
import { attachDictation } from './voice.js';

let A;
export const FORMULA_VIEWS = { formulas: { title: 'Fórmulas', icon: 'sigma' } };
const PI = Math.PI;
const sq = x => x * x;

// v = variável: [chave, nome, unidade, valor padrão (constantes)]
const v = (k, label, unit = '', def) => ({ k, label, unit, def });
// f: devolve "lado esquerdo − lado direito" (zero quando a fórmula fecha); o app resolve qualquer variável
export const FORMULAS = [
  // ---------- MATEMÁTICA ----------
  { id: 'a-quadrado', area: 'mat', group: 'Áreas', name: 'Área do quadrado', expr: 'A = l²', alias: 'quadrado lado area', vars: [v('A', 'Área', 'u²'), v('l', 'Lado', 'u')], f: x => x.A - sq(x.l) },
  { id: 'a-retangulo', area: 'mat', group: 'Áreas', name: 'Área do retângulo', expr: 'A = b · h', alias: 'retangulo base altura', vars: [v('A', 'Área', 'u²'), v('b', 'Base', 'u'), v('h', 'Altura', 'u')], f: x => x.A - x.b * x.h },
  { id: 'a-triangulo', area: 'mat', group: 'Áreas', name: 'Área do triângulo', expr: 'A = (b · h) / 2', alias: 'triangulo base altura', vars: [v('A', 'Área', 'u²'), v('b', 'Base', 'u'), v('h', 'Altura', 'u')], f: x => x.A - (x.b * x.h) / 2 },
  { id: 'a-equilatero', area: 'mat', group: 'Áreas', name: 'Área do triângulo equilátero', expr: 'A = (l² · √3) / 4', alias: 'triangulo equilatero lado', vars: [v('A', 'Área', 'u²'), v('l', 'Lado', 'u')], f: x => x.A - (sq(x.l) * Math.sqrt(3)) / 4 },
  { id: 'a-circulo', area: 'mat', group: 'Áreas', name: 'Área do círculo (da circunferência)', expr: 'A = π · r²', alias: 'circulo circunferencia disco raio pi area', vars: [v('A', 'Área', 'u²'), v('r', 'Raio', 'u')], f: x => x.A - PI * sq(x.r) },
  { id: 'a-trapezio', area: 'mat', group: 'Áreas', name: 'Área do trapézio', expr: 'A = (B + b) · h / 2', alias: 'trapezio base maior menor altura', vars: [v('A', 'Área', 'u²'), v('B', 'Base maior', 'u'), v('b', 'Base menor', 'u'), v('h', 'Altura', 'u')], f: x => x.A - ((x.B + x.b) * x.h) / 2 },
  { id: 'a-losango', area: 'mat', group: 'Áreas', name: 'Área do losango', expr: 'A = (D · d) / 2', alias: 'losango diagonal maior menor', vars: [v('A', 'Área', 'u²'), v('D', 'Diagonal maior', 'u'), v('d', 'Diagonal menor', 'u')], f: x => x.A - (x.D * x.d) / 2 },
  { id: 'a-paralelogramo', area: 'mat', group: 'Áreas', name: 'Área do paralelogramo', expr: 'A = b · h', alias: 'paralelogramo base altura', vars: [v('A', 'Área', 'u²'), v('b', 'Base', 'u'), v('h', 'Altura', 'u')], f: x => x.A - x.b * x.h },
  { id: 'p-circ', area: 'mat', group: 'Perímetros', name: 'Comprimento da circunferência', expr: 'C = 2 · π · r', alias: 'perimetro circunferencia circulo comprimento raio volta', vars: [v('C', 'Comprimento', 'u'), v('r', 'Raio', 'u')], f: x => x.C - 2 * PI * x.r },
  { id: 'p-quadrado', area: 'mat', group: 'Perímetros', name: 'Perímetro do quadrado', expr: 'P = 4 · l', alias: 'perimetro quadrado lado', vars: [v('P', 'Perímetro', 'u'), v('l', 'Lado', 'u')], f: x => x.P - 4 * x.l },
  { id: 'p-retangulo', area: 'mat', group: 'Perímetros', name: 'Perímetro do retângulo', expr: 'P = 2 · (b + h)', alias: 'perimetro retangulo', vars: [v('P', 'Perímetro', 'u'), v('b', 'Base', 'u'), v('h', 'Altura', 'u')], f: x => x.P - 2 * (x.b + x.h) },
  { id: 'v-cubo', area: 'mat', group: 'Volumes', name: 'Volume do cubo', expr: 'V = a³', alias: 'cubo aresta volume', vars: [v('V', 'Volume', 'u³'), v('a', 'Aresta', 'u')], f: x => x.V - x.a ** 3 },
  { id: 'v-paralelepipedo', area: 'mat', group: 'Volumes', name: 'Volume do paralelepípedo (caixa)', expr: 'V = a · b · c', alias: 'paralelepipedo caixa bloco comprimento largura altura volume', vars: [v('V', 'Volume', 'u³'), v('a', 'Comprimento', 'u'), v('b', 'Largura', 'u'), v('c', 'Altura', 'u')], f: x => x.V - x.a * x.b * x.c },
  { id: 'v-cilindro', area: 'mat', group: 'Volumes', name: 'Volume do cilindro', expr: 'V = π · r² · h', alias: 'cilindro raio altura volume', vars: [v('V', 'Volume', 'u³'), v('r', 'Raio', 'u'), v('h', 'Altura', 'u')], f: x => x.V - PI * sq(x.r) * x.h },
  { id: 'v-cone', area: 'mat', group: 'Volumes', name: 'Volume do cone', expr: 'V = (π · r² · h) / 3', alias: 'cone raio altura volume', vars: [v('V', 'Volume', 'u³'), v('r', 'Raio', 'u'), v('h', 'Altura', 'u')], f: x => x.V - (PI * sq(x.r) * x.h) / 3 },
  { id: 'v-esfera', area: 'mat', group: 'Volumes', name: 'Volume da esfera', expr: 'V = (4/3) · π · r³', alias: 'esfera bola raio volume', vars: [v('V', 'Volume', 'u³'), v('r', 'Raio', 'u')], f: x => x.V - (4 / 3) * PI * x.r ** 3 },
  { id: 'v-piramide', area: 'mat', group: 'Volumes', name: 'Volume da pirâmide', expr: 'V = (Ab · h) / 3', alias: 'piramide area da base altura volume', vars: [v('V', 'Volume', 'u³'), v('Ab', 'Área da base', 'u²'), v('h', 'Altura', 'u')], f: x => x.V - (x.Ab * x.h) / 3 },
  { id: 'pitagoras', area: 'mat', group: 'Geometria', name: 'Teorema de Pitágoras', expr: 'a² = b² + c²', alias: 'pitagoras hipotenusa cateto triangulo retangulo', desc: 'a = hipotenusa (lado oposto ao ângulo reto)', vars: [v('a', 'Hipotenusa', 'u'), v('b', 'Cateto b', 'u'), v('c', 'Cateto c', 'u')], f: x => sq(x.a) - sq(x.b) - sq(x.c) },
  { id: 'distancia', area: 'mat', group: 'Geometria', name: 'Distância entre dois pontos', expr: 'd = √((x₂ − x₁)² + (y₂ − y₁)²)', alias: 'distancia pontos plano cartesiano', vars: [v('d', 'Distância'), v('x1', 'x₁'), v('y1', 'y₁'), v('x2', 'x₂'), v('y2', 'y₂')], f: x => x.d - Math.sqrt(sq(x.x2 - x.x1) + sq(x.y2 - x.y1)) },
  { id: 'angulos', area: 'mat', group: 'Geometria', name: 'Soma dos ângulos internos de um polígono', expr: 'S = (n − 2) · 180°', alias: 'angulos internos poligono lados soma', vars: [v('S', 'Soma dos ângulos', '°'), v('n', 'Número de lados')], f: x => x.S - (x.n - 2) * 180 },
  { id: 'bhaskara', area: 'mat', group: 'Álgebra', name: 'Fórmula de Bhaskara (equação do 2º grau)', expr: 'Δ = b² − 4ac · x = (−b ± √Δ) / 2a', alias: 'bhaskara baskara equacao segundo grau delta raizes quadratica', desc: 'Para ax² + bx + c = 0', vars: [v('a', 'a'), v('b', 'b'), v('c', 'c')], custom: bhaskara },
  { id: 'afim', area: 'mat', group: 'Álgebra', name: 'Função afim (do 1º grau)', expr: 'y = a · x + b', alias: 'funcao afim primeiro grau reta coeficiente angular linear', vars: [v('y', 'y'), v('a', 'a (coef. angular)'), v('x', 'x'), v('b', 'b (coef. linear)')], f: x => x.y - (x.a * x.x + x.b) },
  { id: 'regra3', area: 'mat', group: 'Álgebra', name: 'Regra de três simples', expr: 'a / b = c / x', alias: 'regra de tres proporcao', desc: 'a está para b assim como c está para x', vars: [v('a', 'a'), v('b', 'b'), v('c', 'c'), v('x', 'x')], f: x => x.a * x.x - x.b * x.c },
  { id: 'pa', area: 'mat', group: 'Álgebra', name: 'Termo geral da PA', expr: 'aₙ = a₁ + (n − 1) · r', alias: 'progressao aritmetica pa termo geral razao', vars: [v('an', 'aₙ (termo)'), v('a1', 'a₁ (1º termo)'), v('n', 'n (posição)'), v('r', 'r (razão)')], f: x => x.an - (x.a1 + (x.n - 1) * x.r) },
  { id: 'pg', area: 'mat', group: 'Álgebra', name: 'Termo geral da PG', expr: 'aₙ = a₁ · qⁿ⁻¹', alias: 'progressao geometrica pg termo geral razao', vars: [v('an', 'aₙ (termo)'), v('a1', 'a₁ (1º termo)'), v('q', 'q (razão)'), v('n', 'n (posição)')], f: x => x.an - x.a1 * x.q ** (x.n - 1) },
  { id: 'media', area: 'mat', group: 'Estatística', name: 'Média aritmética', expr: 'M = (x₁ + x₂ + … + xₙ) / n', alias: 'media aritmetica nota notas', desc: 'Digite os números separados por ponto e vírgula (;) ou espaço', vars: [v('lista', 'Números')], custom: media },
  { id: 'porcentagem', area: 'mat', group: 'Porcentagem e juros', name: 'Porcentagem', expr: 'P = (p / 100) · V', alias: 'porcentagem por cento desconto', desc: 'Ex.: 15% de 80 → p = 15, V = 80', vars: [v('P', 'Parte (resultado)'), v('p', 'Porcentagem', '%'), v('V', 'Valor total')], f: x => x.P - (x.p / 100) * x.V },
  { id: 'juros-s', area: 'mat', group: 'Porcentagem e juros', name: 'Juros simples', expr: 'J = C · i · t', alias: 'juros simples capital taxa tempo', desc: 'i = taxa em % por período (ex.: 2 para 2% ao mês)', vars: [v('J', 'Juros', 'R$'), v('C', 'Capital', 'R$'), v('i', 'Taxa', '% por período'), v('t', 'Tempo', 'períodos')], f: x => x.J - x.C * (x.i / 100) * x.t },
  { id: 'juros-c', area: 'mat', group: 'Porcentagem e juros', name: 'Juros compostos (montante)', expr: 'M = C · (1 + i)ᵗ', alias: 'juros compostos montante capital taxa', desc: 'i = taxa em % por período', vars: [v('M', 'Montante', 'R$'), v('C', 'Capital', 'R$'), v('i', 'Taxa', '% por período'), v('t', 'Tempo', 'períodos')], f: x => x.M - x.C * (1 + x.i / 100) ** x.t },

  // ---------- FÍSICA ----------
  { id: 'vm', area: 'fis', group: 'Movimento (cinemática)', name: 'Velocidade média', expr: 'v = Δs / Δt', alias: 'velocidade media distancia tempo rapidez', vars: [v('v', 'Velocidade', 'm/s'), v('ds', 'Distância (Δs)', 'm'), v('dt', 'Tempo (Δt)', 's')], f: x => x.v * x.dt - x.ds },
  { id: 'kmh', area: 'fis', group: 'Movimento (cinemática)', name: 'Converter km/h ↔ m/s', expr: 'v(m/s) = v(km/h) / 3,6', alias: 'converter conversao km/h m/s quilometros por hora metros por segundo velocidade', vars: [v('ms', 'Velocidade', 'm/s'), v('kmh', 'Velocidade', 'km/h')], f: x => x.ms * 3.6 - x.kmh },
  { id: 'am', area: 'fis', group: 'Movimento (cinemática)', name: 'Aceleração média', expr: 'a = Δv / Δt', alias: 'aceleracao media variacao de velocidade', vars: [v('a', 'Aceleração', 'm/s²'), v('dv', 'Variação da velocidade (Δv)', 'm/s'), v('dt', 'Tempo (Δt)', 's')], f: x => x.a * x.dt - x.dv },
  { id: 'mu', area: 'fis', group: 'Movimento (cinemática)', name: 'Movimento uniforme (função horária da posição)', expr: 'S = S₀ + v · t', alias: 'movimento uniforme mu posicao funcao horaria espaco', vars: [v('S', 'Posição final', 'm'), v('S0', 'Posição inicial (S₀)', 'm'), v('v', 'Velocidade', 'm/s'), v('t', 'Tempo', 's')], f: x => x.S - (x.S0 + x.v * x.t) },
  { id: 'muv-v', area: 'fis', group: 'Movimento (cinemática)', name: 'Velocidade no MUV (com aceleração)', expr: 'v = v₀ + a · t', alias: 'velocidade aceleracao muv movimento uniformemente variado funcao horaria da velocidade variacao', vars: [v('v', 'Velocidade final', 'm/s'), v('v0', 'Velocidade inicial (v₀)', 'm/s'), v('a', 'Aceleração', 'm/s²'), v('t', 'Tempo', 's')], f: x => x.v - (x.v0 + x.a * x.t) },
  { id: 'muv-s', area: 'fis', group: 'Movimento (cinemática)', name: 'Posição no MUV (sorvetão)', expr: 'S = S₀ + v₀ · t + (a · t²) / 2', alias: 'posicao muv sorvetao espaco aceleracao funcao horaria', vars: [v('S', 'Posição final', 'm'), v('S0', 'Posição inicial (S₀)', 'm'), v('v0', 'Velocidade inicial (v₀)', 'm/s'), v('t', 'Tempo', 's'), v('a', 'Aceleração', 'm/s²')], f: x => x.S - (x.S0 + x.v0 * x.t + (x.a * sq(x.t)) / 2) },
  { id: 'torricelli', area: 'fis', group: 'Movimento (cinemática)', name: 'Equação de Torricelli', expr: 'v² = v₀² + 2 · a · Δs', alias: 'torricelli velocidade aceleracao distancia sem tempo', vars: [v('v', 'Velocidade final', 'm/s'), v('v0', 'Velocidade inicial (v₀)', 'm/s'), v('a', 'Aceleração', 'm/s²'), v('ds', 'Distância (Δs)', 'm')], f: x => sq(x.v) - (sq(x.v0) + 2 * x.a * x.ds) },
  { id: 'queda', area: 'fis', group: 'Movimento (cinemática)', name: 'Queda livre (altura)', expr: 'h = (g · t²) / 2', alias: 'queda livre altura gravidade tempo', vars: [v('h', 'Altura', 'm'), v('g', 'Gravidade', 'm/s²', 9.8), v('t', 'Tempo', 's')], f: x => x.h - (x.g * sq(x.t)) / 2 },
  { id: 'mcu', area: 'fis', group: 'Movimento (cinemática)', name: 'Velocidade no movimento circular', expr: 'v = (2 · π · R) / T', alias: 'movimento circular mcu periodo raio velocidade linear', vars: [v('v', 'Velocidade', 'm/s'), v('R', 'Raio', 'm'), v('T', 'Período', 's')], f: x => x.v * x.T - 2 * PI * x.R },
  { id: 'acp', area: 'fis', group: 'Movimento (cinemática)', name: 'Aceleração centrípeta', expr: 'ac = v² / R', alias: 'aceleracao centripeta curva circular', vars: [v('ac', 'Aceleração centrípeta', 'm/s²'), v('v', 'Velocidade', 'm/s'), v('R', 'Raio', 'm')], f: x => x.ac * x.R - sq(x.v) },
  { id: 'newton', area: 'fis', group: 'Forças (dinâmica)', name: 'Força (2ª lei de Newton)', expr: 'F = m · a', alias: 'forca resultante segunda lei de newton massa aceleracao', vars: [v('F', 'Força', 'N'), v('m', 'Massa', 'kg'), v('a', 'Aceleração', 'm/s²')], f: x => x.F - x.m * x.a },
  { id: 'peso', area: 'fis', group: 'Forças (dinâmica)', name: 'Força peso', expr: 'P = m · g', alias: 'peso forca peso massa gravidade', vars: [v('P', 'Peso', 'N'), v('m', 'Massa', 'kg'), v('g', 'Gravidade', 'm/s²', 9.8)], f: x => x.P - x.m * x.g },
  { id: 'atrito', area: 'fis', group: 'Forças (dinâmica)', name: 'Força de atrito', expr: 'Fat = μ · N', alias: 'atrito coeficiente normal forca de atrito', vars: [v('Fat', 'Força de atrito', 'N'), v('mu', 'Coeficiente de atrito (μ)'), v('N', 'Força normal', 'N')], f: x => x.Fat - x.mu * x.N },
  { id: 'hooke', area: 'fis', group: 'Forças (dinâmica)', name: 'Força elástica (lei de Hooke)', expr: 'F = k · x', alias: 'hooke mola forca elastica deformacao constante elastica', vars: [v('F', 'Força', 'N'), v('k', 'Constante da mola', 'N/m'), v('x', 'Deformação', 'm')], f: x => x.F - x.k * x.x },
  { id: 'gravitacao', area: 'fis', group: 'Forças (dinâmica)', name: 'Gravitação universal', expr: 'F = G · M · m / d²', alias: 'gravitacao universal newton atracao massas', vars: [v('F', 'Força', 'N'), v('G', 'Constante G', 'N·m²/kg²', 6.674e-11), v('M', 'Massa 1', 'kg'), v('m', 'Massa 2', 'kg'), v('d', 'Distância', 'm')], f: x => x.F * sq(x.d) - x.G * x.M * x.m },
  { id: 'qmov', area: 'fis', group: 'Forças (dinâmica)', name: 'Quantidade de movimento', expr: 'Q = m · v', alias: 'quantidade de movimento momento linear', vars: [v('Q', 'Quantidade de movimento', 'kg·m/s'), v('m', 'Massa', 'kg'), v('v', 'Velocidade', 'm/s')], f: x => x.Q - x.m * x.v },
  { id: 'impulso', area: 'fis', group: 'Forças (dinâmica)', name: 'Impulso', expr: 'I = F · Δt', alias: 'impulso forca tempo', vars: [v('I', 'Impulso', 'N·s'), v('F', 'Força', 'N'), v('dt', 'Tempo (Δt)', 's')], f: x => x.I - x.F * x.dt },
  { id: 'trabalho', area: 'fis', group: 'Energia e trabalho', name: 'Trabalho de uma força', expr: 'τ = F · d', alias: 'trabalho forca deslocamento distancia', vars: [v('T', 'Trabalho (τ)', 'J'), v('F', 'Força', 'N'), v('d', 'Deslocamento', 'm')], f: x => x.T - x.F * x.d },
  { id: 'ec', area: 'fis', group: 'Energia e trabalho', name: 'Energia cinética', expr: 'Ec = (m · v²) / 2', alias: 'energia cinetica movimento', vars: [v('Ec', 'Energia cinética', 'J'), v('m', 'Massa', 'kg'), v('v', 'Velocidade', 'm/s')], f: x => x.Ec - (x.m * sq(x.v)) / 2 },
  { id: 'epg', area: 'fis', group: 'Energia e trabalho', name: 'Energia potencial gravitacional', expr: 'Ep = m · g · h', alias: 'energia potencial gravitacional altura', vars: [v('Ep', 'Energia potencial', 'J'), v('m', 'Massa', 'kg'), v('g', 'Gravidade', 'm/s²', 9.8), v('h', 'Altura', 'm')], f: x => x.Ep - x.m * x.g * x.h },
  { id: 'epe', area: 'fis', group: 'Energia e trabalho', name: 'Energia potencial elástica', expr: 'Ee = (k · x²) / 2', alias: 'energia potencial elastica mola', vars: [v('Ee', 'Energia elástica', 'J'), v('k', 'Constante da mola', 'N/m'), v('x', 'Deformação', 'm')], f: x => x.Ee - (x.k * sq(x.x)) / 2 },
  { id: 'potencia', area: 'fis', group: 'Energia e trabalho', name: 'Potência', expr: 'P = τ / Δt', alias: 'potencia trabalho energia tempo watt', vars: [v('P', 'Potência', 'W'), v('T', 'Trabalho ou energia', 'J'), v('dt', 'Tempo (Δt)', 's')], f: x => x.P * x.dt - x.T },
  { id: 'pressao', area: 'fis', group: 'Fluidos', name: 'Pressão', expr: 'p = F / A', alias: 'pressao forca area', vars: [v('p', 'Pressão', 'Pa'), v('F', 'Força', 'N'), v('A', 'Área', 'm²')], f: x => x.p * x.A - x.F },
  { id: 'densidade', area: 'fis', group: 'Fluidos', name: 'Densidade', expr: 'd = m / V', alias: 'densidade massa especifica volume', vars: [v('d', 'Densidade', 'kg/m³'), v('m', 'Massa', 'kg'), v('V', 'Volume', 'm³')], f: x => x.d * x.V - x.m },
  { id: 'hidrostatica', area: 'fis', group: 'Fluidos', name: 'Pressão hidrostática (Stevin)', expr: 'p = d · g · h', alias: 'pressao hidrostatica stevin profundidade liquido', vars: [v('p', 'Pressão', 'Pa'), v('d', 'Densidade do líquido', 'kg/m³', 1000), v('g', 'Gravidade', 'm/s²', 9.8), v('h', 'Profundidade', 'm')], f: x => x.p - x.d * x.g * x.h },
  { id: 'empuxo', area: 'fis', group: 'Fluidos', name: 'Empuxo (Arquimedes)', expr: 'E = d · V · g', alias: 'empuxo arquimedes flutuar volume submerso', vars: [v('E', 'Empuxo', 'N'), v('d', 'Densidade do líquido', 'kg/m³', 1000), v('V', 'Volume submerso', 'm³'), v('g', 'Gravidade', 'm/s²', 9.8)], f: x => x.E - x.d * x.V * x.g },
  { id: 'calor', area: 'fis', group: 'Calor (termologia)', name: 'Calor sensível', expr: 'Q = m · c · ΔT', alias: 'calor sensivel quantidade de calor calor especifico temperatura', vars: [v('Q', 'Calor', 'cal'), v('m', 'Massa', 'g'), v('c', 'Calor específico', 'cal/g°C', 1), v('dT', 'Variação de temperatura (ΔT)', '°C')], f: x => x.Q - x.m * x.c * x.dT },
  { id: 'latente', area: 'fis', group: 'Calor (termologia)', name: 'Calor latente', expr: 'Q = m · L', alias: 'calor latente mudanca de estado fusao vaporizacao', vars: [v('Q', 'Calor', 'cal'), v('m', 'Massa', 'g'), v('L', 'Calor latente', 'cal/g')], f: x => x.Q - x.m * x.L },
  { id: 'dilatacao', area: 'fis', group: 'Calor (termologia)', name: 'Dilatação linear', expr: 'ΔL = L₀ · α · ΔT', alias: 'dilatacao linear termica coeficiente', vars: [v('dL', 'Dilatação (ΔL)', 'm'), v('L0', 'Comprimento inicial (L₀)', 'm'), v('alfa', 'Coeficiente (α)', '1/°C'), v('dT', 'Variação de temperatura (ΔT)', '°C')], f: x => x.dL - x.L0 * x.alfa * x.dT },
  { id: 'gases', area: 'fis', group: 'Calor (termologia)', name: 'Gases ideais (Clapeyron)', expr: 'p · V = n · R · T', alias: 'gases ideais clapeyron pressao volume temperatura mols', desc: 'T em kelvin (K = °C + 273)', vars: [v('p', 'Pressão', 'atm'), v('V', 'Volume', 'L'), v('n', 'Número de mols', 'mol'), v('R', 'Constante R', 'atm·L/mol·K', 0.082), v('T', 'Temperatura', 'K')], f: x => x.p * x.V - x.n * x.R * x.T },
  { id: 'celsius', area: 'fis', group: 'Calor (termologia)', name: 'Converter °C ↔ °F', expr: 'C / 5 = (F − 32) / 9', alias: 'converter celsius fahrenheit temperatura escala', vars: [v('C', 'Celsius', '°C'), v('F', 'Fahrenheit', '°F')], f: x => x.C / 5 - (x.F - 32) / 9 },
  { id: 'onda', area: 'fis', group: 'Ondas', name: 'Velocidade de uma onda', expr: 'v = λ · f', alias: 'onda velocidade comprimento de onda frequencia lambda', vars: [v('v', 'Velocidade', 'm/s'), v('l', 'Comprimento de onda (λ)', 'm'), v('f', 'Frequência', 'Hz')], f: x => x.v - x.l * x.f },
  { id: 'periodo', area: 'fis', group: 'Ondas', name: 'Frequência e período', expr: 'f = 1 / T', alias: 'frequencia periodo hertz', vars: [v('f', 'Frequência', 'Hz'), v('T', 'Período', 's')], f: x => x.f * x.T - 1 },
  { id: 'ohm', area: 'fis', group: 'Eletricidade', name: 'Lei de Ohm', expr: 'U = R · i', alias: 'lei de ohm tensao resistencia corrente voltagem ddp', vars: [v('U', 'Tensão', 'V'), v('R', 'Resistência', 'Ω'), v('i', 'Corrente', 'A')], f: x => x.U - x.R * x.i },
  { id: 'pot-el', area: 'fis', group: 'Eletricidade', name: 'Potência elétrica', expr: 'P = U · i', alias: 'potencia eletrica tensao corrente watts', vars: [v('P', 'Potência', 'W'), v('U', 'Tensão', 'V'), v('i', 'Corrente', 'A')], f: x => x.P - x.U * x.i },
  { id: 'consumo', area: 'fis', group: 'Eletricidade', name: 'Energia elétrica (consumo)', expr: 'E = P · Δt', alias: 'energia eletrica consumo kwh conta de luz', desc: 'Com P em kW e Δt em horas, E sai em kWh', vars: [v('E', 'Energia', 'kWh'), v('P', 'Potência', 'kW'), v('dt', 'Tempo (Δt)', 'h')], f: x => x.E - x.P * x.dt },
  { id: 'carga', area: 'fis', group: 'Eletricidade', name: 'Corrente elétrica e carga', expr: 'i = Q / Δt', alias: 'corrente eletrica carga tempo coulomb', vars: [v('i', 'Corrente', 'A'), v('Q', 'Carga', 'C'), v('dt', 'Tempo (Δt)', 's')], f: x => x.i * x.dt - x.Q },
  { id: 'coulomb', area: 'fis', group: 'Eletricidade', name: 'Lei de Coulomb', expr: 'F = k · |Q₁ · Q₂| / d²', alias: 'coulomb forca eletrica cargas', vars: [v('F', 'Força', 'N'), v('k', 'Constante k', 'N·m²/C²', 8.99e9), v('Q1', 'Carga 1', 'C'), v('Q2', 'Carga 2', 'C'), v('d', 'Distância', 'm')], f: x => x.F * sq(x.d) - x.k * Math.abs(x.Q1 * x.Q2) },
  { id: 'refracao', area: 'fis', group: 'Óptica', name: 'Índice de refração', expr: 'n = c / v', alias: 'indice de refracao luz optica', vars: [v('n', 'Índice de refração'), v('c', 'Velocidade da luz no vácuo', 'm/s', 3e8), v('v', 'Velocidade no meio', 'm/s')], f: x => x.n * x.v - x.c },
];
const AREAS = { all: 'Todas', mat: '📐 Matemática', fis: '⚛️ Física' };

// ---------- contas ----------
// aceita "2,5", "1.234,5", "2.5", "3 × 10^8" e "3e8"
const num = s => {
  let t = String(s).trim().replace(/\s/g, '');
  if (!t) return null;
  t = t.replace(/[×x]10\^/i, 'e');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
export function fmt(x, group = true) {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e7 || a < 1e-3)) { const [m, e] = x.toExponential(3).split('e'); return `${(+m).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} × 10^${+e}`; }
  return x.toLocaleString('pt-BR', { maximumFractionDigits: a < 1 ? 5 : 4, useGrouping: group });
}
// Descobre a variável que falta: tenta vários pontos de partida (método de Newton) e prefere o resultado positivo
export function solve(F, known, unknown) {
  const g = t => F.f({ ...known, [unknown]: t });
  const roots = [];
  for (const x0 of [1, 10, 0.5, 100, 0.01, 1000, 1e5, -1, -10, 3, 1e-6, 1e9]) {
    let x = x0;
    for (let i = 0; i < 100; i++) {
      const y = g(x);
      if (!Number.isFinite(y)) break;
      const hh = 1e-7 * Math.max(1, Math.abs(x));
      const d = (g(x + hh) - g(x - hh)) / (2 * hh);
      if (!Number.isFinite(d) || d === 0) break;
      const nx = x - y / d;
      if (Math.abs(nx - x) <= 1e-12 * Math.max(1, Math.abs(nx))) { x = nx; break; }
      x = nx;
    }
    // é raiz de verdade se o erro em x é desprezível: compara g(x) com g num ponto bem pertinho
    if (!Number.isFinite(x)) continue;
    const gx = Math.abs(g(x)), near = Math.abs(g(x * (1 + 1e-4) + 1e-12));
    if (gx === 0 || (Number.isFinite(near) && gx <= 1e-5 * near)) roots.push(x);
  }
  if (!roots.length) return null;
  const pos = roots.filter(r => r > 0);
  const best = (pos.length ? pos : roots).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
  return Math.abs(best) < 1e-12 ? 0 : +best.toPrecision(12);
}
function bhaskara(x) {
  const { a, b, c } = x;
  if ([a, b, c].some(n => n == null || Number.isNaN(n))) return null;
  if (a === 0) return { lines: ['a não pode ser 0 (não seria equação do 2º grau).'] };
  const d = b * b - 4 * a * c;
  const out = [`Δ = b² − 4ac = ${fmt(b)}² − 4 · ${fmt(a)} · ${fmt(c)} = ${fmt(d)}`];
  if (d < 0) out.push('Δ < 0: não há raízes reais.');
  else if (d === 0) out.push(`Δ = 0: uma raiz → x = −b / 2a = ${fmt(-b / (2 * a))}`);
  else out.push(`x₁ = (−b + √Δ) / 2a = ${fmt((-b + Math.sqrt(d)) / (2 * a))}`, `x₂ = (−b − √Δ) / 2a = ${fmt((-b - Math.sqrt(d)) / (2 * a))}`);
  return { lines: out };
}
function media(x, raw) {
  const nums = String(raw.lista || '').split(/[;\s]+/).map(num).filter(n => n != null && !Number.isNaN(n));
  if (!nums.length) return null;
  const s = nums.reduce((a, n) => a + n, 0);
  return { lines: [`Soma = ${fmt(s)} · quantidade = ${nums.length}`, `Média = ${fmt(s)} / ${nums.length} = ${fmt(s / nums.length)}`] };
}

// ---------- busca ----------
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set('qual quais a o as os da do das dos de e formula formulas como calcula calcular calculo eh e em para pra um uma me diga que se no na nos nas por ao'.split(' '));
const stem = w => (w.length > 4 ? w.replace(/(oes|aes|es|s)$/, '') : w);
const words = s => norm(s).split(/[^a-z0-9²³/]+/).filter(w => w && !STOP.has(w)).map(stem);
export function searchFormulas(q, area = 'all') {
  const list = FORMULAS.filter(F => area === 'all' || F.area === area);
  const qs = words(q);
  if (!qs.length) return list;
  const scored = [];
  for (const F of list) {
    const name = words(F.name), alias = words(F.alias || ''), extra = words(`${F.group} ${F.desc || ''} ${F.vars.map(x => x.label).join(' ')}`);
    let score = 0, all = true;
    for (const w of qs) {
      const hit = arr => arr.some(t => t === w || (w.length >= 3 && (t.startsWith(w) || w.startsWith(t) && t.length >= 4)));
      if (hit(name)) score += 3; else if (hit(alias)) score += 2; else if (hit(extra)) score += 1; else all = false;
    }
    if (all) scored.push([score + (norm(F.name).includes(norm(q).trim()) ? 2 : 0), F]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(x => x[1]);
}

// ---------- tela ----------
let query = '', area = 'all', openId = null;
const values = {}; // o que foi digitado em cada fórmula (fica enquanto o app está aberto)
export function initFormulas(api) { A = api; }
export function openFormula(id) { const F = FORMULAS.find(f => f.id === id); if (!F) return; query = F.name; area = 'all'; openId = id; A.go('formulas'); }

function calcHTML(F) {
  const vals = values[F.id] || {};
  return `<div class="fm-calc" data-id="${F.id}">
    ${F.desc ? `<p class="muted small">${esc(F.desc)}</p>` : ''}
    <div class="fm-vars">${F.vars.map(x => `<label class="fm-var"><span>${esc(x.label)}${x.unit ? ` <em>(${esc(x.unit)})</em>` : ''}</span>
      <input class="input" data-k="${x.k}" ${x.k === 'lista' ? 'inputmode="text" placeholder="Ex.: 7; 8,5; 6"' : 'inputmode="decimal"'} value="${esc(vals[x.k] ?? (x.def != null ? String(x.def).replace('.', ',') : ''))}" autocomplete="off"></label>`).join('')}</div>
    <div class="fm-out" aria-live="polite">${F.custom ? 'Preencha os números.' : 'Preencha todos os valores, menos o que você quer descobrir: o app calcula na hora.'}</div>
    <div class="row wrap"><button class="btn small-btn" data-fm="clear">${ic('trash')}<span>Limpar</span></button>
      <button class="btn small-btn" data-fm="copy">${ic('copy')}<span>Copiar</span></button>
      <button class="btn small-btn" data-fm="quick">${ic('sticky')}<span>Salvar em Notas rápidas</span></button></div>
  </div>`;
}
// Recalcula a fórmula aberta
function compute(box, F) {
  const inputs = [...box.querySelectorAll('input[data-k]')];
  const out = box.querySelector('.fm-out');
  const raw = Object.fromEntries(inputs.map(i => [i.dataset.k, i.value]));
  // guarda só o que você digitou (o valor calculado é refeito)
  values[F.id] = Object.fromEntries(inputs.filter(i => !i.dataset.auto).map(i => [i.dataset.k, i.value]));
  inputs.forEach(i => i.classList.remove('fm-auto', 'fm-bad'));
  const known = {}, empty = [];
  for (const i of inputs) {
    if (i.dataset.auto) { empty.push(i); continue; }
    const n = num(i.value);
    if (n == null) empty.push(i); else if (Number.isNaN(n)) i.classList.add('fm-bad'); else known[i.dataset.k] = n;
  }
  if (F.custom) {
    const r = F.custom(known, raw);
    out.innerHTML = r ? r.lines.map(l => `<div class="fm-res">${esc(l)}</div>`).join('') : 'Preencha os números.';
    return r ? r.lines.join('\n') : '';
  }
  if (inputs.some(i => i.classList.contains('fm-bad'))) { out.textContent = 'Algum número está escrito errado. Use vírgula para decimais (ex.: 2,5).'; return ''; }
  if (empty.length !== 1) {
    inputs.forEach(i => { if (i.dataset.auto) { i.value = ''; delete i.dataset.auto; } });
    out.textContent = empty.length ? `Falta${empty.length > 1 ? 'm' : ''} ${empty.length} valor${empty.length > 1 ? 'es' : ''}: deixe em branco só o que você quer descobrir.` : 'Apague o valor que você quer descobrir: o app calcula.';
    return '';
  }
  const target = empty[0], V = F.vars.find(x => x.k === target.dataset.k);
  const r = solve(F, known, V.k);
  if (r == null) { target.value = ''; delete target.dataset.auto; out.textContent = 'Com esses números não existe resultado (confira os valores).'; return ''; }
  target.value = fmt(r, false); target.dataset.auto = '1'; target.classList.add('fm-auto');
  const text = `${V.label} = ${fmt(r)}${V.unit ? ' ' + V.unit : ''}`;
  out.innerHTML = `<div class="fm-res big">✓ ${esc(text)}</div><div class="muted small">Pela fórmula ${esc(F.expr)}</div>`;
  return `${F.name}: ${F.expr}\n${F.vars.filter(x => x.k !== V.k).map(x => `${x.label} = ${raw[x.k]}${x.unit ? ' ' + x.unit : ''}`).join('; ')}\n→ ${text}`;
}

export function renderFormulas(el) {
  const list = searchFormulas(query, area);
  const groups = [];
  for (const F of list) { const g = groups.find(x => x[0] === F.group); if (g) g[1].push(F); else groups.push([F.group, [F]]); }
  if (query.trim() && list.length && !list.some(F => F.id === openId)) openId = list[0].id;
  const card = F => `<div class="panel fm-card ${F.id === openId ? 'open' : ''}" data-fid="${F.id}">
    <button class="fm-head" data-open="${F.id}"><span class="grow"><b>${esc(F.name)}</b><small>${F.area === 'mat' ? '📐 Matemática' : '⚛️ Física'} · ${esc(F.group)}</small></span>
      <span class="fm-expr">${esc(F.expr)}</span></button>
    ${F.id === openId ? calcHTML(F) : ''}</div>`;
  el.innerHTML = `<div class="panel fm-search">
      <div class="row"><input class="input grow" id="fm-q" type="search" placeholder="Ex.: área do círculo, fórmula da força, velocidade média…" value="${esc(query)}" autocomplete="off">
        <button class="icon-btn" id="fm-mic" aria-label="Falar o nome da fórmula">${ic('mic')}</button></div>
      <div class="row wrap fm-areas">${Object.entries(AREAS).map(([k, l]) => `<button class="chip ${area === k ? 'on' : ''}" data-area="${k}">${l}</button>`).join('')}
        <span class="muted small grow">${list.length} fórmula${list.length !== 1 ? 's' : ''}</span></div></div>
    ${list.length ? (query.trim() ? `<div class="fm-list">${list.map(card).join('')}</div>`
      : groups.map(([g, fs]) => `<h3 class="sec">${esc(g)}</h3><div class="fm-list">${fs.map(card).join('')}</div>`).join(''))
    : `<div class="panel fm-none"><p>Não achei “${esc(query)}” na tabela.</p><button class="btn primary" id="fm-tutor">${ic('chat')}<span>Perguntar ao Tutor IA</span></button></div>`}`;
  const q = el.querySelector('#fm-q');
  q.oninput = () => { query = q.value; const pos = q.selectionStart; openId = null; renderFormulas(el); const q2 = el.querySelector('#fm-q'); q2.focus(); q2.setSelectionRange(pos, pos); };
  attachDictation(el.querySelector('#fm-mic'), q);
  q.addEventListener('change', () => { if (q.value !== query) q.oninput(); });
  el.querySelectorAll('[data-area]').forEach(b => b.onclick = () => { area = b.dataset.area; renderFormulas(el); });
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { openId = openId === b.dataset.open ? null : b.dataset.open; renderFormulas(el); el.querySelector('.fm-card.open')?.scrollIntoView({ block: 'nearest' }); });
  el.querySelector('#fm-tutor')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(`Qual é a fórmula de ${query}? Explique cada letra e dê um exemplo.`); toast('Pergunta copiada: cole no Tutor'); } catch { /* */ }
    A.go('tutor');
  });
  const box = el.querySelector('.fm-calc');
  if (!box) return;
  const F = FORMULAS.find(f => f.id === box.dataset.id);
  let last = compute(box, F);
  box.querySelectorAll('input[data-k]').forEach(i => i.addEventListener('input', () => { delete i.dataset.auto; last = compute(box, F); }));
  box.querySelector('[data-fm=clear]').onclick = () => { values[F.id] = {}; box.querySelectorAll('input[data-k]').forEach(i => { delete i.dataset.auto; const V = F.vars.find(x => x.k === i.dataset.k); i.value = V.def != null ? String(V.def).replace('.', ',') : ''; }); last = compute(box, F); };
  box.querySelector('[data-fm=copy]').onclick = async () => { try { await navigator.clipboard.writeText(last || `${F.name}: ${F.expr}`); toast('Copiado'); } catch { toast('Não foi possível copiar'); } };
  box.querySelector('[data-fm=quick]').onclick = async () => { await A.addQuick(last || `${F.name}: ${F.expr}`); toast('Salvo em Notas rápidas ✓'); };
}
