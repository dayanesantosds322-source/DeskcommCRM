/**
 * Campanha a partir de lista pronta. Só gente com a chave de escrita opera isto.
 * O agente publicado não recebe a ferramenta: ela não envia, mas monta a fila
 * que uma pessoa ainda precisa revisar no cartão.
 */
import { declararTools } from "./tipos";

export const TOOLS_PROSPECCAO = declararTools([
  {
    name: "crm_create_prospecting_list_draft",
    category: "write",
    rotulo: "Guardar lista como rascunho de campanha",
    explicacao:
      "Recebe empresas que alguém já escolheu e guarda nome, celular e origem numa campanha parada. Não manda mensagem e não liga o disparo. Quem inicia as abordagens continua sendo uma pessoa, no cartão da tela.",
    oQueToca: "Campanha de abordagem",
    risco: "atencao",
    pacotes: ["vender"],
    apenasHumano: true,
  },
]);
