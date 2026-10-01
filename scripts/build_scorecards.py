#!/usr/bin/env python3
"""生成每只股票一份 scorecard CSV(Feature/Score/Rationale)+ 一张总表 _summary.csv
(每股一行,每维 = "分 (核心理由)")。3 维,单分,-5~+5(0=中性,正=好/看多,负=差/看空):
  Operation 经营   —— 财务指标(含资本支出/估值/EV/FCF)、股权变化(回购/稀释)
  Leadership 管理层 —— 执行/战略/可信度/Adaptability/Alignment/政府关系
  Externality 外部 —— 行业竞争、宏观压力、新闻(监管/罚款)
理由用括号括在分数边上,写该维得分/减分的核心驱动(可逐项 ±)。草稿,非投资建议。
输出到 research/scorecards/(随公开站点一起发布;个股分析非私密,仅 portfolio 部分内容本地私有)。"""
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "research" / "scorecards"
OUT.mkdir(parents=True, exist_ok=True)

FEATURES = ["Operation", "Leadership", "Externality"]

# direction: L=多头 / S=空头 / W=Watch(无仓位)。每股 3 项按 FEATURES 顺序 = (score, rationale)。
# 分值 -5~+5。★=需当前数据校准,⚠=身份/数据存疑。估值/EV/FCF 已并入 Operation(经营)。
STOCKS = {
 "NVDA": ("W", [
  (4, "净现金+巨额 FCF、资产负债表极强;大额回购;轻晶圆(台积代工)"),
  (4, "黄仁勋创始人掌舵、路线图执行顶级、高持股 alignment、适应力强"),
  (2, "AI 芯片垂直整合+CUDA 护城河;但 AI capex 绝对值过大、本身成 macro 风险")]),
 "GOOG": ("W", [
  (2, "搜索/广告现金牛+净现金;巨额 AI capex、回购暂停,或拖累 FCF"),
  (1, "双创始人控盘+技术深厚,但 Gemini 上 AI 适应偏被动;反垄断/政府摩擦"),
  (2, "搜索垄断+云三强+AI 全栈,但反垄断风险")]),
 "MU": ("L", [
  (3, "GM 85% +5;capex $27b→FY27 mid-$40B, 过半建厂 -1;HBM 客户集中(NVDA/cloud) -1"),
  (0, "unknown"),
  (0, "ai bubble -0;美国产 +1；台湾地缘风险 -1")]),
 "SNDK": ("L", [
  (4, "FY26 rev $20B +175%、datacenter $12B、Q3 +251% +3;GM 71.5%(NAND 短缺+LTA)+2;零债务+$6B 回购+100% 余现返还 +2;capex 重(BiCS8)+GM 周期峰 -3"),
  (0, ""),
  (1, "NAND 结构性短缺+AI datacenter 需求爆发(成最大 NAND 段)+2;+Kioxia JV(共用日本 Yokkaichi/Kitakami fab、合计~25%=#2 platform)+1;但 NAND 6 玩家分散(三星29/SK+Solidigm18/美光15/Kioxia14/SanDisk11)护城河弱于 DRAM -1;SanDisk 份额掉13.9→11.4%+中国 YMTC 出货超 Kioxia -1")]),
 "SKHY": ("L", [
  (4, "Q2’26 rev $56.6B +257% YoY、OP $43.2B +557%、OPM 76%，HBM/AI server memory高增长叠加DRAM/NAND涨价，盈利处于历史极强水平 4；HBM仍全球#1、Q2份额50，HBM4已量产/HBM4E送样，但份额Q1 58%→50、Samsung 21%→33，领先优势收窄 2；现金62.9B vs debt 13.3B净现金约49.6B，Q2 FCF约$39.1B，另宣布约$28.6B回购注销(~3.3% shares)，资产负债表/现金创造能力发生质变 +4；约10家客户签多年LTA，使HBM逐渐从传统commodity模式转向提前锁量/co-development，降低盈利周期性 +2；FY26 CapEx预计约$34B+，另批准Y2+M17合计约$38.8B fab投资，SKH/Samsung/Micron同步扩产，当前shortage及76% OPM明显不可直接外推，未来核心风险是供给释放+HBM竞争导致margin normalization -2。"),
  (0, ""),
  (3, "AI/HBM需求仍极强：27年bit shipment仍预计+50–60%；9大CSP CapEx 26年>$887B +~90%、27年~$1.3T +~50% +3；HBM极耗wafer，预计占三大厂DRAM wafer input 18%(25)→22%(26)→~30%(27)，却仅贡献~13% DRAM bits，挤压传统DRAM供给，供给紧至27年 +3；但Samsung HBM份额21→33%、SKH 58→50%，Micron亦扩TSV/先进DRAM，SKH/Samsung/Micron巨额新fab约28年后陆续释放，当前shortage/76% OPM存在周期反转风险 -2；需求高度集中于NVIDIA/Google及少数hyperscaler，且NVIDIA已因HBM成本/供应考虑降低Rubin Ultra潜在单卡配置 -1；中国CXMT等成熟DRAM追赶压低端价格，但先进制程/HBM受美日荷设备限制，短期反而保护SKH高端壁垒 +1；无锡DRAM/大连NAND等中国资产暴露于美国出口管制及中美关系，政策变化可能限制设备升级/产能运营 -1")]),
 "HOOD": ("L", [
  (4, "Q2 rev $1.31B(+32%)、GAAP OM 43.9%/净利$573M +3;13 业务线过$100M、去 crypto 化(crypto 8%、−38%)+2;轻资产+回购+SBC 仅$105M/8%(偏低)+1;仍受交易量/风险偏好顺周期 -2"),
  (3, "Tenev 创始人、产品创新极快(预测市场10x/futures/index options/tokenization/Legend)=adaptability 顶级 +3;高 alignment +1;2021 GME 停牌+PFOF/监管旧账 -1"),
  (-1, "散户经纪领先年轻用户+多元化 +1;竞争(Schwab/Coinbase/Webull)-1;顺周期(交易量/风险偏好/利率)+PFOF/预测市场监管灰色 -1")]),
 "COHR": ("L", [
  (3, "FY26 rev $7.12B +23%(首破$70亿)、Q4 $2.05B +34%(pro forma +42%)、环比加速 1.58→1.69→1.81→2.05 +3;非GAAP GM 40.2%(+215bp)/op inc $446M +62%/EPS $1.74 +74% +2;去杠杆完成 net lev 2.0→0.7x(FY26 还债$513M+卖A&D $400M)、现金$3B、$4.1B 并购债已消化 +3;datacenter capex 暴增 Q4 $556M(去年$131M)、~18mo 回本、near-term FCF 承压 -2;GAAP 净利率仅 11.8%、光模块 GM 结构性偏低 -1"),
  (3, "Jim Anderson 2024-06 上任、前 Lattice CEO(2018-24 经典 turnaround)=顶级运营者 +3;两年内 speed-to-market 聚焦 AI datacenter+剪枝(卖 A&D $400M/SiC 变现)+去杠杆+拿下 NVIDIA=执行强 +2;职业经理人非创始、上任仅两年、持股 alignment 一般 -1"),
  (2, "AI 光互联超级周期 800G→1.6T、Datacenter&Comms 占 Q4 79%/+59% YoY=踩最强 secular +2;NVIDIA 战略入股$2B+多年数十亿采购承诺+产能权(2026-03)=需求锚+背书 +2;InP 铟磷激光垂直整合(自有 fab)=真护城河 +1;份额被超:InnoLight #1~27%、Eoptolink 2025 冲$3.5B(+189%)升#2 反超 COHR(~17%)、中系低价 20-25%/供~2/3 出货 -2;客户集中(datacom 79%+NVDA 锚)+AI capex 顺周期、消化即大回撤 -2;FCC 拟禁中系 transceiver=非对称利好 +1")]),
 "CCL": ("L", [
  (4, "Q2 rev 记录 $6.7B 同比 +5.3%、net yields +2%(连续12季度增长)、客户存款史高 $9B;去杠杆到位:net debt/EBITDA 3.4→3.1x、Fitch 投资级、$19B 再融资一年内完成、利率降至 4.6%、恢复分红"),
  (2, "Weinstein 职业经理人、turnaround 执行强(达投资级/复股息/$19B 再融资)+3;Arison 家族控盘 ~44% 股/~33% 投票权、Micky 任主席=长期 alignment +1;巴拿马注册+方便旗避 US 税/监管(政府关系弱、政治靶子)-1;无燃油对冲 -1"),
  (-1, "燃料成本 ±10% → CCL 净利 ±$145M -1;指引假设$90/桶; 利率只影响需求不影响发债 -0；需求强(booking 史上最长、2027>PY)+双寡头(CCL+RCL 62%)，但有追赶者 -0")]),
 "RKLB": ("L", [
  (-2, "rev +62%($234M)、GM 41.5% +2;Space Systems 多元 +1;FCF -$110M/季、2028前难转正 -2;股数+20%/年 -2;未来预计稀释15% -1"),
  (4, "Beck 创始人+Electron 50+ 发射 +2;美国国防关系深(SDA>$1.3B、NSSL上限$17B、HASTE) +2;欧洲 RL Germany/NZ本土 +1;创始人~10%但近期减持$286M +0;Neutron 反复跳票 -1"),
  (2, "商业+国防航天结构性高增、backlog $2.36B/90+任务 +2;SpaceX 之下第二梯队领先 +1;SpaceX绝对主导+成长股利率敏感 -1;散户 ~40-45% -0")]),
 "AMD": ("W", [
  (2, "EPYC 抢 Intel 份额+MI 放量;资产负债表干净/低杠杆/FCF 正;大额回购但 SBC 稀释偏高"),
  (3, "Lisa Su 执行力/turnaround 杰出、信誉高、适应力强"),
  (2, "AI 加速器需求强但 NVDA 主导+云 ASIC 蚕食,竞争位第二、两头受压")]),
 "CRWV": ("S", [
  (-4, "Q2'26 rev $2.575B +112%、GM ~66%、adj EBITDA $1.51B(~59%)、backlog $104.2B +246%(Q3 初再+$25B)=看着很美 +3;债均利率 ~11%=光利息吃~1/4 营收、FY26 capex $35-39B(>2.5x 营收)+GPU 折旧快 -4;市值$55B/P/B 9.8/亏损无 P/E、EV ~$75-90B 对 ~$13B 营收+深负 FCF(TTM -$10.6B) -3"),
  (0, "Intrator 联创/CEO(2017 挖矿转 AI 云)、爆发扩张+签 MSFT/OpenAI/Anthropic/Meta+2025-03 IPO=执行/拿单强 +2;内部人自 IPO 抛>$23 亿、CEO 每~2 周减持$25-38M(10b5-1)、lockup 解禁 83% Class A=alignment 差 -2"),
  (-1, "AI 云 capex 超级顺风+$104B 合约 backlog 背书 +2;客户极度集中 MSFT ~72% 1H26 营收(FY25 67%)、OpenAI 单笔$22.4B=前二撑绝大多数 -2;客户即对手(MSFT/Meta 自建产能)+neocloud(Nebius/Lambda/Crusoe)竞争 -1;债务融资模式对利率/信用极敏感+NVDA 供货/配额依赖 -1;新增 Anthropic/Meta 略分散 backlog +1")]),
 "NBIS": ("S", [
  (-1, "rev +454%($582M)、Nebius AI +514%、ARR $3B→FY26 guide $7-9B、adj EBITDA 转正 $236M/41% +3;资金优于 CRWV:$5.75B 可转债(0.5%'30/4.5%'34 低息)+Yandex $2.8B 现金垫+NVIDIA $2B 股权+客户预付款、现金~$8B≈债 $8.5B、Deloitte 审(2026 换掉小所 Reanda)+2;但代价是持续稀释:NVIDIA warrants 21M+$5.75B 可转债悬顶(转股价$313/$325)+债转股 15.8M+SBC(经济股 272M→293M)-1;capex $20-25B>>营收 $3-3.4B、FCF 深负 -2;mktcap $66B/P/E 856 on ~$3B 营收、52wk $63→$300→~$235 高 beta -3"),
  (1, "Volozh(Yandex 创始人)技术深、把 Yandex 分拆快速重定位 AI 云、拿下 MSFT $17.5B/Meta $27B、EBITDA 转正=执行/拿单强 +2;Volozh 曾受欧盟制裁(2022-24 后撤销)+俄罗斯/Yandex legacy/治理地缘观感 -1;控股结构杂(Toloka 数据/Avride 自驾/TripleTen 教育+ClickHouse 股权)=聚焦/资本配置存疑 -0"),
  (0, "AI 云 capex 超级顺风+$40-46B 合约 backlog(Meta $27B/MSFT $17.5B)+四笔~$10 亿级大单 +2;客户高度集中(MSFT/Meta 撑 backlog)+客户即对手(自建+TPU/MTIA 自研)-2;neocloud 混战(CRWV/Lambda/Crusoe)+NVIDIA 供货/配额依赖 -1;客户预付款(覆盖 50-60% capex)+现金垫(低息可转债非11%高息)→对利率/信用敏感度低于 CRWV +1")]),
 "CRWD": ("W", [
  (2, "云安全龙头、高毛利 SaaS、现金流强/净现金;回购有限、SBC 稀释"),
  (1, "Kurtz 创始人执行强,但 2024-07 全球宕机重创信誉;适应力尚可"),
  (1, "网络安全高增,竞争 Palo Alto/微软;IT 预算顺周期但安全刚需")]),
 "NET": ("W", [
  (1, "边缘/安全高增+AI 推理边缘布局,但 margin 仅 14%、现金流改善中;SBC 稀释高、可转债 strike 497"),
  (1, "Prince 创始人产品/执行强、愿景足,但稀释偏高"),
  (1, "边缘/安全结构性增长;成长股利率敏感")]),
 "PANW": ("W", [
  (2, "安全平台化龙头、留存高、现金流强;回购+SBC"),
  (3, "Nikesh Arora 平台化执行卓越、信誉强"),
  (1, "安全整合领导者;安全刚需/IT 预算")]),
 "NOW": ("W", [
  (3, "企业工作流 SaaS 龙头、留存 98%、usage 订阅;回购>SBC"),
  (3, "McDermott 执行强、信誉高"),
  (1, "企业 SaaS 龙头;利率敏感、IT 预算顺周期")]),
 "COIN": ("W", [
  (1, "加密交易所龙头,收入随周期大起大落、订阅/USDC 多元化;现金厚但盈利波动极大"),
  (2, "Armstrong 创始人;监管博弈/游说(政府关系)老练;高 alignment"),
  (1, "交易所竞争+费率压缩但合规龙头;极度受加密/风险偏好/利率驱动")]),
 "SNOW": ("W", [
  (3, "云数仓高增、消费模式、净留存高、FCF 转正;SBC 稀释高、回购启动"),
  (1, "Slootman→Ramaswamy 换帅,新 CEO(ex-Google AI)可信;增速放缓"),
  (1, "数据平台竞争激烈(Databricks/云厂);云支出顺周期")]),
 "INTC": ("S", [
  (0, "Q2’26 rev $16.13B +25%、GAAP GM 40.4%(+12.9ppt)/OPM 11.1%(vs -24.7%)，核心Products明显复苏：rev $15.14B +28%、OP $4.82B=31.8% OPM，其中DCAI $6.26B +59%/OPM 39.5% +3；Foundry Q2 rev $5.77B、OP -$2.09B(-36%)，先进18A制程yield增大进一步拉低op -1；Q2末debt $50.5B，net debt $20.8B（25年底仅$9.2B)，gross interest约$2.4B年化，新债利率高 -2."),
  (-2, "管理层动荡+信誉受损(屡次下调指引/路线图落后)、turnaround 未验证;裁员可能是双刃剑"),
  (1, "竞争位弱 -1；政府注资，存在战略不可替代 0；政府可能强制second source chip maker +1；和skhy合作建memory的传闻 +1")]),
 "MSTR": ("S", [
  (-3, "本质=杠杆 BTC 持仓:845,050 BTC/成本 $63.73B(均价~$75.4k),软件业务仅~$0.5B/年 near-irrelevant;$15.5B 永续优先股+$6.75B 可转债、年股息~$1.7B(STRC $10.5B@11.5%),软件收入远不够付→Saylor 已承认或卖 BTC 付息=强制卖方 -3;mNAV 稀释 0.81×(<1)→增发买币/付息由增值变毁灭、flywheel 反转 -2;但已跌 63%($365→$82→~$135)、折价于 BTC NAV=froth 已挤 +2"),
  (0, "Saylor(exec chairman)发明 BTC 国库打法+资本市场执行大师(募数百亿)+创始人高信念/重仓 alignment +2;all-in 单一资产 maximalism=零风险管理/bet-the-company -1;Saylor 法律旧账(2000 SEC 会计欺诈和解、2022 DC 逃税 $40M 和解)+集权治理 -1"),
  (-5, "纯 BTC 价格/加密监管/利率的宏观杠杆敞口、高 beta 顺周期 -2;反身性:体量大、若 BTC 续跌+优先股息逼迫→卖币螺旋 -1;copycat BTC 国库公司(Metaplanet 等)泛滥稀释稀缺 -0;可能被剔除纳指100+监管潜在压力(crypto 法案不通过+公司优先股问题)-2")]),
 # 未分析标的：空分数，不视为中性评分，也不进入打分快照。
 "BE": ("W", [(None, ""), (None, ""), (None, "")]),
 "ASST": ("W", [(None, ""), (None, ""), (None, "")]),
 "PURR": ("W", [(None, ""), (None, ""), (None, "")]),
 "MOD": ("W", [(None, ""), (None, ""), (None, "")]),
 "STRL": ("W", [(None, ""), (None, ""), (None, "")]),
 "LITE": ("W", [(None, ""), (None, ""), (None, "")]),
}

DIR_FULL = {"L": "Long", "S": "Short", "W": "Watch"}
ORDER = ["SKHY", "MU", "SNDK", "HOOD", "COHR", "GOOG", "NVDA", "CCL", "RKLB",
         "AMD", "CRWV", "NBIS", "CRWD", "NET", "PANW", "NOW", "COIN", "SNOW", "INTC", "MSTR",
         "BE", "ASST", "PURR", "MOD", "STRL", "LITE"]

summary_rows = []
snapshot = {}                                                # 本次打分快照(供 IC 研究)
for tk in ORDER:
    direction, items = STOCKS[tk]
    with open(OUT / f"{tk}.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow([f"# {tk}", "方向=" + {"L": "多头 Long", "S": "空头 Short", "W": "Watch 无仓位"}[direction],
                    "分值 -5~+5(0=中性,正=好/看多,负=差/看空)"])
        w.writerow(["Feature", "Score", "Rationale"])
        for feat, (score, rat) in zip(FEATURES, items):
            w.writerow([feat, score, rat])
    cells = ["" if score is None else f"{score} ({rat})" for score, rat in items]     # 每维 = "分 (理由)"
    summary_rows.append([tk, DIR_FULL[direction], *cells])
    scores = [s for s, _ in items]
    if any(score is None for score in scores):
        continue  # 未完成分析，不生成可用于 IC 的分数
    snapshot[tk] = {"dir": direction,
                    "scores": dict(zip(FEATURES, scores)),
                    "mean": round(sum(scores) / len(scores), 3)}  # 聚合分(等权)= IC 的预测变量

with open(OUT / "_summary.csv", "w", newline="", encoding="utf-8-sig") as fh:
    w = csv.writer(fh)
    w.writerow(["Ticker", "Direction", *FEATURES])
    for row in summary_rows:
        w.writerow(row)

# 打分快照存档:每天一条(同日覆盖),给未来的 scorecard→forward-return rank-IC 研究攒样本。
HIST = OUT / "_score_history.json"
try:
    history = json.loads(HIST.read_text(encoding="utf-8")) if HIST.exists() else {}
except (ValueError, OSError):
    history = {}
today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
history[today] = {"features": FEATURES, "scores": snapshot}
HIST.write_text(json.dumps(history, ensure_ascii=False, indent=1), encoding="utf-8")

print(f"生成 {len(ORDER)} 份个股 CSV + _summary.csv(3 维,单分)→ {OUT}")
print(f"打分快照 → {HIST.name}(累计 {len(history)} 天;≥N 天后可算 forward-return IC)")
