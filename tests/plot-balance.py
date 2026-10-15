"""Optional report figure. Requires matplotlib; no production game dependencies."""
import json
import os
from pathlib import Path

os.environ.setdefault('MPLCONFIGDIR', '/tmp/aetheria-matplotlib')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = Path(os.environ.get('BALANCE_EVIDENCE', 'docs/balance-review'))
runs = json.loads((root / 'series.json').read_text())
runs.sort(key=lambda run: (['observe', 'economy', 'defense'].index(run['strategy']), run['phase'] != 'before-food-fix'))
colors = {'observe': '#64748b', 'economy': '#059669', 'defense': '#2563eb'}
fig, axes = plt.subplots(2, 1, figsize=(10, 6.5), sharex=True, constrained_layout=True)
for run in runs:
    samples = run['samples']
    x = [s['gameSeconds'] for s in samples]
    style = '--' if run['phase'] == 'before-food-fix' else '-'
    for ax, field in zip(axes, ['population', 'food']):
        ax.plot(x, [s[field] for s in samples], style, color=colors[run['strategy']], label=run['id'], linewidth=1.5)
    for previous, current in zip(samples, samples[1:]):
        if current['era'] != previous['era']:
            axes[0].plot(current['gameSeconds'], current['population'], '*', color=colors[run['strategy']], markersize=11)
            axes[0].annotate(f"era {current['era']} reset", (current['gameSeconds'], current['population']), fontsize=7, xytext=(-65, 6), textcoords='offset points')
for ax in axes:
    ax.axvspan((20 - 8.2) / .11, (24 + 5.5 - 8.2) / .11, color='#c7d2fe', alpha=.35, label='First night')
    ax.grid(alpha=.2)
    ax.set_ylim(bottom=0)
    ax.spines[['top', 'right']].set_visible(False)
axes[0].set_ylabel('Living population')
axes[1].set_ylabel('Food in store')
axes[1].set_xlabel('Elapsed game seconds (UI speed 5x)')
handles, labels = axes[0].get_legend_handles_labels()
fig.legend(handles, labels, loc='outside lower center', ncol=4, fontsize=8)
phases = {run['phase'] for run in runs}
subtitle = 'Before/after NPC food and access fixes' if {'before-food-fix', 'after-npc-fix'} <= phases else 'Current-version UI playthroughs'
fig.suptitle(f'AETHERIA: {len(runs)} exploratory UI-driven runs\n{subtitle}; unpaired worlds/events; not a controlled ranking', fontsize=11)
fig.savefig(root / 'population-food.svg')
fig.savefig(root / 'population-food.png', dpi=150)
