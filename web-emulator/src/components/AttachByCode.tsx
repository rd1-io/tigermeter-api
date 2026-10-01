import React, { useEffect, useState } from "react";
import { apiClient, TenantDto } from "../api/client";

interface AttachByCodeProps {
  scope: string;
  tenantId: string;
  onAttached?: (deviceId: string) => void;
}

const LAST_TENANT_KEY = 'attachTenantId';

const describeError = (status: number, message: string): string => {
  if (message === 'Invalid code') return 'Код не найден. Проверьте цифры на экране устройства.';
  if (message === 'Expired code') return 'Код истёк (живёт 5 минут). Устройство само запросит новый — введите код с экрана.';
  if (message === 'Already claimed') return 'Код уже использован: устройство привязано.';
  if (message === 'Tenant is reserved') return 'Тенант зарезервирован (staging или служебный ops), к нему привязывать нельзя.';
  if (message === 'Unknown tenant') return 'Тенант не найден среди service-токенов (SERVICE_TOKENS).';
  if (status === 401) return 'Токен недействителен, войдите заново.';
  if (status === 403) return `Недостаточно прав: ${message}`;
  if (status === 429) return 'Слишком много попыток, подождите минуту.';
  return message || `Ошибка ${status}`;
};

export const AttachByCode: React.FC<AttachByCodeProps> = ({ scope, tenantId, onAttached }) => {
  const isOps = scope === 'ops';
  const [code, setCode] = useState("");
  const [tenants, setTenants] = useState<TenantDto[]>([]);
  const [targetTenant, setTargetTenant] = useState(localStorage.getItem(LAST_TENANT_KEY) || "");
  const [externalUserId, setExternalUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; deviceId?: string } | null>(null);

  useEffect(() => {
    if (!isOps) return;
    (async () => {
      const resp = await apiClient.listTenants();
      if (!resp.ok) return;
      const list: TenantDto[] = await resp.json();
      setTenants(list);
      setTargetTenant((cur) => (list.some((t) => t.tenantId === cur) ? cur : list[0]?.tenantId ?? ""));
    })();
  }, [isOps]);

  const canSubmit = /^\d{6}$/.test(code) && (isOps ? !!targetTenant : !!externalUserId.trim()) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    try {
      const resp = await apiClient.attachClaim(code, {
        tenantId: isOps ? targetTenant : undefined,
        externalUserId: externalUserId.trim() || undefined,
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        if (isOps) localStorage.setItem(LAST_TENANT_KEY, targetTenant);
        setResult({
          ok: true,
          deviceId: data.deviceId,
          text: `Привязано к тенанту «${data.tenantId}». Устройство заберёт секрет при следующем опросе (каждые 3 с) и покажет «Connected!».`,
        });
        setCode("");
      } else {
        setResult({ ok: false, text: describeError(resp.status, data.message ?? '') });
      }
    } catch (e: any) {
      setResult({ ok: false, text: 'Не удалось подключиться: ' + e.message });
    }
    setBusy(false);
  };

  return (
    <div className="bg-white rounded-md border shadow-sm">
      <div className="px-4 py-3 border-b">
        <h2 className="font-semibold">Привязка по коду</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          6-значный код с экрана устройства (действует 5 минут).
          {isOps ? ' Админ привязывает от имени выбранного тенанта.' : ` Устройство будет привязано к тенанту «${tenantId}».`}
        </p>
      </div>
      <div className="p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-neutral-500 block">Код</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            inputMode="numeric"
            placeholder="123456"
            className="border rounded px-2 py-1.5 text-lg font-mono tracking-[0.3em] w-36"
          />
        </div>
        {isOps && (
          <div>
            <label className="text-xs text-neutral-500 block">Тенант</label>
            <select
              value={targetTenant}
              onChange={(e) => setTargetTenant(e.target.value)}
              className="border rounded px-2 py-2 text-sm min-w-[10rem]"
            >
              {tenants.length === 0 && <option value="">нет тенантов</option>}
              {tenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.tenantId} ({t.scopes.join(', ')})
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs text-neutral-500 block">
            Внешний пользователь {isOps ? '(необязательно)' : ''}
          </label>
          <input
            value={externalUserId}
            onChange={(e) => setExternalUserId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="externalUserId"
            maxLength={128}
            className="border rounded px-2 py-2 text-sm w-48"
          />
        </div>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Привязка...' : 'Привязать'}
        </button>
      </div>
      {result && (
        <div className={`mx-4 mb-4 px-3 py-2 rounded text-sm flex items-center gap-3 ${result.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
          <span>{result.text}</span>
          {result.ok && result.deviceId && onAttached && (
            <button onClick={() => onAttached(result.deviceId!)} className="ml-auto text-xs bg-green-600 text-white px-2 py-1 rounded whitespace-nowrap">
              Открыть тест устройства
            </button>
          )}
        </div>
      )}
    </div>
  );
};
