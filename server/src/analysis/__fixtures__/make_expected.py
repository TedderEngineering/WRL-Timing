"""Derive the G2 acceptance expectations from the Stage 1 fixtures and stage2/core/fixture_deltas.json.

Writes expected/<race>.json with derived values only (no raw timing rows), keyed by (car, in-lap).
Run: python3 -I make_expected.py  (needs /home/claude/rt/audit1c and /home/claude/stage2/core).
Mapping: FACT_ENGINE_SPEC.md §8.1; deltas C1-C7 and V1 applied as listed in DEFINITIONS.md §6.
"""
import json, os

A = '/home/claude/rt/audit1c/alkamel/fixtures/'
W = '/home/claude/rt/audit1c/wrl/fixtures/'
DELTAS = json.load(open('/home/claude/stage2/core/fixture_deltas.json'))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'expected')
os.makedirs(OUT, exist_ok=True)


def clock(s):
    if s is None:
        return None
    h, m, x = s.split(':')
    return round(int(h) * 3600 + int(m) * 60 + float(x), 3)


def delta_rows(key, fixture):
    return [r for r in DELTAS[key] if r['fixture'] == fixture]


def fcy_level(fixture):
    for r in DELTAS['V1_race_level_fcy']:
        if r['fixture'] == fixture:
            return r['stage2']
    return None


def alkamel(race):
    fixture = f'alkamel/fixtures/{race}.json'
    fx = json.load(open(A + race + '.json'))
    c1 = {(r['car'], r['in_lap']): r for r in delta_rows('C1', fixture) + delta_rows('C2', fixture)}
    c3 = delta_rows('C3', fixture)
    grouped = {(r['car'], p[0]): r for r in c3 for p in r['passages']}
    c6 = {(r['car'], r['pit_in_clock']): r['stage2'] for r in delta_rows('C6', fixture)}
    c7 = {(r['car'], r['in_lap']): r['stage2'] for r in delta_rows('C7', fixture)}
    passages = []
    for car, lst in fx['stops'].items():
        for s in lst:
            in_lap = s['in_lap']
            in_completed = True
            if in_lap is None:
                in_lap = c6[(car, s['pit_in_clock'])]
                in_completed = False
            out_lap = s['out_lap']
            # kind / outcome (C5)
            kind, outcome = s['kind'], 'rejoined' if out_lap is not None else 'retired'
            if s['kind'] == 'stop' and (s['long_stop'] or out_lap is None):
                if out_lap is None:
                    kind = 'retirement'
                    if race == 'mpc_road_atlanta' and car == '12' and s['in_lap'] == 77:
                        kind, outcome = 'stop', 'finished_in_pit_lane'
                else:
                    kind = 'garage'
            ctx = 'fcy' if s['under_fcy'] else ('mixed' if s['fcy_boundary'] else 'green')
            ctx = c7.get((car, s['in_lap']), ctx)
            e = {'car': car, 'pitInClockS': clock(s['pit_in_clock']), 'pitOutClockS': clock(s['pit_out_clock']),
                 'inLap': in_lap, 'inLapCompleted': in_completed, 'outLap': out_lap, 'kind': kind, 'outcome': outcome,
                 'fcyContext': ctx,
                 # B-flag-only passages have no official record (D-PITLANE): Stage 1 printed race_end - estimate.
                 # AO2 (card in-time = a line crossing): Stage 1 nulled the value; D-PITLANE keeps the card value
                 # with pitLaneTimeReliable = false.
                 'officialPitLaneTimeS': None if (outcome == 'retired' or s['official_card_value_s'] is None) else (s['official_pit_lane_time_s'] if s['official_pit_lane_time_s'] is not None else s['official_card_value_s']),
                 'pitLaneTimeReliable': None if s['official_card_value_s'] is None or outcome == 'retired' else s['official_pit_lane_time_s'] is not None}
            # time lost
            key = (car, s['in_lap'])
            if key in grouped:
                e['timeLost'] = {'method': 'see_group', 'valueS': None}
            elif kind in ('retirement', 'pit_lane_start') or outcome != 'rejoined':
                e['timeLost'] = {'method': 'none', 'valueS': None}
            elif key in c1:
                r = c1[key]
                e['timeLost'] = {'method': r['stage2_method'].split(' ')[0], 'valueS': r['stage2']}
            else:
                e['timeLost'] = {'method': 'green_reference', 'valueS': s['pit_time_lost_b_s'],
                                 'refLapS': s['ref_green_lap_s'], 'refWindowLaps': s['ref_window_laps'], 'refLapCount': s['ref_n_laps']}
            # positions through the stop (members: cycleResults; others: positionEffect)
            if outcome == 'rejoined' and kind != 'pit_lane_start' and s['before_lap']:
                e['position'] = {'beforeLap': s['before_lap'], 'afterLap': s['after_lap'],
                                 'classPosBefore': s['class_pos_before'], 'classPosAfter': s['class_pos_after'], 'netClass': s['net_class'],
                                 'overallPosBefore': s['overall_pos_before'], 'overallPosAfter': s['overall_pos_after'], 'netOverall': s['net_overall'],
                                 'gainedOn': sorted((g.replace(' (retired)', '') for g in (s['gained_on'] or [])), key=lambda x: (len(x), x)),
                                 'lostTo': sorted(s['lost_to'] or [], key=lambda x: (len(x), x))}
            if outcome == 'rejoined' and kind != 'pit_lane_start':
                e['lapDown'] = s['lap_down_in_stop']
            e['cycle'] = None
            if s['cycle_id'] is not None and kind == 'stop' and outcome == 'rejoined':
                cls, n = s['cycle_id'].rsplit('-', 1)
                e['cycle'] = {'id': f'cycle:{cls}:{n}', 'members': sorted(s['cycle_members'], key=lambda x: (len(x), x))}
            passages.append(e)
    groups = [{'car': r['car'], 'laps': r['stage2_group_laps'], 'method': r['method'], 'valueS': r['stage2_group_time_lost_s']} for r in c3]
    cycles = [{'id': 'cycle:%s:%s' % tuple(c['id'].rsplit('-', 1)), 'members': sorted(c['members'], key=lambda x: (len(x), x)),
               'opensClockS': clock(c['first_pit_in']), 'closesClockS': clock(c['last_pit_out']), 'nMembers': c['n_stops']} for c in fx['cycles']]
    fcy = fcy_level(fixture) or [[clock(a), clock(b)] for a, b in fx['fcy_intervals_clock']]
    return {'race': race, 'family': 'alkamel', 'derivedFrom': ['audit1c/alkamel/fixtures/' + race + '.json', 'stage2/core/fixture_deltas.json'],
            'fcyIntervalsClockS': fcy, 'fcyReconstructed': fcy_level(fixture) is not None,
            'fcyLeaderLaps': fx['fcy_laps_leader'] if fcy_level(fixture) is None else None,
            'classMedianCleanGreenLapS': fx['class_median_green_lap_s'], 'transitEstimateS': fx['min_pit_lane_passage_s'],
            'groups': groups, 'cycles': cycles, 'passages': passages}


WKIND = {'stop': 'stop', 'long_stop': 'stop', 'unknown': 'stop', 'garage': 'garage', 'retired_in_pit': 'retirement',
         'drive_through_candidate': 'drive_through', 'pit_flag_no_loss': 'stop'}


def wrl(race):
    fixture = f'wrl/fixtures/{race}.json'
    fx = json.load(open(W + race + '.json'))
    c4 = {(r['car'], r['in_lap']): r for r in delta_rows('C4', fixture)}
    passages = []
    for car, c in fx['cars'].items():
        for s in c['stops']:
            kind = WKIND[s['kind']]
            outcome = 'retired' if s['kind'] == 'retired_in_pit' else 'rejoined'
            e = {'car': car, 'inLap': s['in_lap'], 'outLap': s['out_lap'], 'kind': kind, 'outcome': outcome,
                 'underFcy': s['under_fcy'], 'stage1Kind': s['kind']}
            if outcome != 'rejoined':
                e['timeLost'] = {'method': 'none', 'valueS': None}
            elif s['under_fcy']:
                if s['pit_time_lost_field'] is None:
                    e['timeLost'] = {'method': 'fcy_fallback_or_none', 'valueS': None}
                else:
                    e['timeLost'] = {'method': 'fcy_neighbours', 'valueS': s['pit_time_lost_field']}
            else:
                e['timeLost'] = {'method': 'green_reference', 'valueS': s['pit_time_lost_green_ref'], 'refLapS': s['ref_green_s']}
            members = s['cycle_members']
            after = s['after_lap']
            d = c4.get((car, s['in_lap']))
            if d:
                members, after = d['cycle_members'][1], d['after_lap'][1]
                assert d['net_change_class'][0] == d['net_change_class'][1]
            if s['kind'] in ('pit_flag_no_loss',):
                members = None
            if outcome == 'rejoined' and s['class_pos_before'] is not None and after is not None:
                e['position'] = {'afterLap': after, 'classPosBefore': s['class_pos_before'], 'classPosAfter': s['class_pos_after'],
                                 'netClass': s['net_change_class'],
                                 'overallPosBefore': s['overall_pos_before'], 'overallPosAfter': s['overall_pos_after'],
                                 'gainedOn': sorted(s['passed'] or [], key=lambda x: (len(x), x)),
                                 'lostTo': sorted(s['passed_by'] or [], key=lambda x: (len(x), x)),
                                 'lapsDownBefore': s['laps_down_before'], 'lapsDownAfter': s['laps_down_after']}
            e['cycle'] = {'members': sorted(members, key=lambda x: (len(x), x)), 'type': s['cycle_type']} if (members and kind == 'stop' and outcome == 'rejoined') else None
            passages.append(e)
    return {'race': race, 'family': 'wrl', 'derivedFrom': ['audit1c/wrl/fixtures/' + race + '.json', 'stage2/core/fixture_deltas.json'],
            'fcyIntervalsRaceS': fcy_level(fixture), 'classMedianCleanGreenLapS': fx['class_median_green_lap_s'], 'passages': passages}


for race in ['mpc_road_atlanta', 'gt4_indy_r1', 'gt4_indy_r2', 'sro_cota_r1', 'grcup_cota_r1']:
    json.dump(alkamel(race), open(os.path.join(OUT, race + '.json'), 'w'), indent=1)
for race in ['barber', 'cota_sat', 'sunday7']:
    json.dump(wrl(race), open(os.path.join(OUT, race + '.json'), 'w'), indent=1)
print('wrote', sorted(os.listdir(OUT)))
