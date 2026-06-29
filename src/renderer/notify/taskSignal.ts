// Máquina de estados pura para detectar "tarefa da IA concluída" por inatividade.
// O painel arma ao receber input do usuário, marca quando chega output, e ao ficar
// ocioso decide se notifica — só dispara se houve um ciclo input→output→silêncio.
export interface ArmState {
  armed: boolean
  sawOutput: boolean
}

export const initialArm = (): ArmState => ({ armed: false, sawOutput: false })

// usuário enviou algo ao terminal: começa um novo ciclo (reseta output visto)
export const armOnInput = (): ArmState => ({ armed: true, sawOutput: false })

// chegou output: relevante só se estamos num ciclo armado
export const noteOutput = (s: ArmState): ArmState =>
  s.armed && !s.sawOutput ? { armed: true, sawOutput: true } : s

// silêncio detectado: notifica se houve input+output; sempre desarma ao notificar
export const onIdle = (s: ArmState): { fire: boolean; next: ArmState } =>
  s.armed && s.sawOutput ? { fire: true, next: initialArm() } : { fire: false, next: s }
