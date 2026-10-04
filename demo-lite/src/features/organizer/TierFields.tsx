import type { Dispatch, SetStateAction } from 'react';
import { money, type EventInput, type EventDto } from '@ticketchain/shared';
type Props = {
  value: EventInput;
  setValue: Dispatch<SetStateAction<EventInput>>;
  prices: string[];
  setPrices: Dispatch<SetStateAction<string[]>>;
  event?: EventDto;
};
export function TierFields({
  value,
  setValue,
  prices,
  setPrices,
  event: e,
}: Props) {
  return (
    <>
      <h2>Ticket tiers</h2>
      <p>
        Removing a saved tier retains its booking history and existing holds.
      </p>
      {value.tiers.map((tier, i) => (
        <fieldset key={tier.id || i}>
          <legend>Tier {i + 1}</legend>
          <label>
            Tier name
            <input
              required
              value={tier.name}
              maxLength={80}
              onChange={(ev) =>
                setValue({
                  ...value,
                  tiers: value.tiers.map((t, n) =>
                    n === i ? { ...t, name: ev.target.value } : t,
                  ),
                })
              }
            />
          </label>
          <label>
            Price per ticket (₹)
            <input
              required
              inputMode="decimal"
              value={prices[i]}
              onChange={(ev) =>
                setPrices(prices.map((p, n) => (n === i ? ev.target.value : p)))
              }
            />
          </label>
          <label>
            Total inventory
            <input
              type="number"
              required
              min={1}
              max={10000}
              value={tier.quantity}
              onChange={(ev) =>
                setValue({
                  ...value,
                  tiers: value.tiers.map((t, n) =>
                    n === i ? { ...t, quantity: Number(ev.target.value) } : t,
                  ),
                })
              }
            />
          </label>

          <label>
            Inclusions (one per line)
            <textarea
              value={tier.inclusions?.join('\n') || ''}
              onChange={(ev) =>
                setValue({
                  ...value,
                  tiers: value.tiers.map((t, n) =>
                    n === i
                      ? {
                          ...t,
                          inclusions: ev.target.value.split('\n'),
                        }
                      : t,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            disabled={value.tiers.length === 1}
            onClick={() => {
              setValue({
                ...value,
                tiers: value.tiers.filter((_, n) => n !== i),
              });
              setPrices(prices.filter((_, n) => n !== i));
            }}
          >
            Remove tier
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={value.tiers.length >= 10}
        onClick={() => {
          setValue({
            ...value,
            tiers: [
              ...value.tiers,
              { name: '', pricePaise: 149900, quantity: 100 },
            ],
          });
          setPrices([...prices, '1499.00']);
        }}
      >
        Add tier +
      </button>
      {!!e?.retired_tiers?.length && (
        <section>
          <h2>Retired tier history</h2>
          {e.retired_tiers.map((t) => (
            <p key={t.id}>
              {t.name} · {money(t.price_paise)} · retired from sales
            </p>
          ))}
        </section>
      )}
    </>
  );
}
