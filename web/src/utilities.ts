// 一般送配電事業者 — where grid connection applications are filed in Japan.
export const UTILITIES: Record<string, { ja: string; zh: string }> = {
  hokkaido: { ja: '北海道電力ネットワーク', zh: '北海道电力网络' },
  tohoku: { ja: '東北電力ネットワーク', zh: '东北电力网络' },
  tepco: { ja: '東京電力パワーグリッド', zh: '东京电力 Power Grid' },
  chubu: { ja: '中部電力パワーグリッド', zh: '中部电力 Power Grid' },
  hokuriku: { ja: '北陸電力送配電', zh: '北陆电力输配电' },
  kansai: { ja: '関西電力送配電', zh: '关西电力输配电' },
  chugoku: { ja: '中国電力ネットワーク', zh: '中国电力网络' },
  shikoku: { ja: '四国電力送配電', zh: '四国电力输配电' },
  kyushu: { ja: '九州電力送配電', zh: '九州电力输配电' },
  okinawa: { ja: '沖縄電力', zh: '冲绳电力' },
}

export const LAND_STATUS_ZH = { former: '工厂/电厂跡地', vacant: '空地', park: '工业团地', unknown: '工业用地（用途不明）', occupied: '使用中的工厂/设施' } as const
export const LAND_STATUS_JA = { former: '工場・発電所跡地', vacant: '未利用地', park: '工業団地', unknown: '工業用地（用途不明）', occupied: '稼働中の工場・施設' } as const

export const LAND_TYPE_ZH = { brownfield: '闲置/再开发用地', greenfield: '未开发空地', industrial: '工业用地' } as const
export const LAND_TYPE_JA = { brownfield: '跡地・再開発用地', greenfield: '未利用地', industrial: '工業用地' } as const
