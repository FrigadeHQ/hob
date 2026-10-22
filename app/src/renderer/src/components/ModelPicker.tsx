import { useState } from 'react'
import type { ModelOption } from '../../../shared/types'
import { Dialog } from './ui'

const gb = (n: number) => `${Math.ceil(n * 10) / 10} GB`
const why = { memory: 'Needs more memory', slow: 'Too slow on this computer' }

/** A model in the picker. inUse and downloaded come from Settings: no download needed for those. */
type PickerModel = ModelOption & { active?: boolean; downloaded?: boolean }

function ModelRow({ model, selected, onPick }: { model: PickerModel; selected: boolean; onPick(): void }) {
  return (
    <label data-testid="model-option" className={`setup-model-option ${model.available ? '' : 'unavailable'}`}>
      <input type="radio" name="setup-model" value={model.id} checked={selected} disabled={!model.available} onChange={onPick} aria-label={model.name} />
      <span className="setup-option-copy">
        <span className="setup-option-title">
          {model.name}
          {model.active ? <span className="setup-tag">In use</span> : model.recommended && <span className="setup-tag">Recommended</span>}
        </span>
        <span className="setup-option-description">{model.available ? model.description : why[model.reason ?? 'memory']}</span>
      </span>
      {model.available && <span className="setup-option-size">{model.downloaded ? 'Downloaded' : gb(model.sizeGB)}</span>}
    </label>
  )
}

/** Choosing a model: the same dialog at setup and in Settings → Model. */
export function ModelPicker({ models, selected, onSelect, onClose, note = 'You can change this later in Settings.' }: {
  models: PickerModel[]; selected: ModelOption; onSelect(id: string): void; onClose(): void; note?: string
}) {
  const [draft, setDraft] = useState(selected.id)
  return (
    <Dialog title="Choose a model" onClose={onClose} testId="setup-model-dialog" className="setup-dialog">
      <p className="setup-dialog-description">Pick a balance of capability, speed, and download size.</p>
      <div className="setup-model-scroll"><fieldset>
        <legend className="sr-only">Available models</legend>
        {models.filter((m) => m.available).map((model) => <ModelRow key={model.id} model={model} selected={model.id === draft} onPick={() => setDraft(model.id)} />)}
        {models.some((m) => !m.available) && <p className="setup-model-section">Needs a more powerful computer</p>}
        {models.filter((m) => !m.available).map((model) => <ModelRow key={model.id} model={model} selected={false} onPick={() => {}} />)}
      </fieldset></div>
      <div className="setup-dialog-footer">
        <span>{note}</span>
        <button className="setup-primary" onClick={() => { onSelect(draft); onClose() }}>Use this model</button>
      </div>
    </Dialog>
  )
}
