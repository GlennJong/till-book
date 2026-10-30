import { useState } from 'react';
import { Delete } from 'lucide-react';

// 網頁數字鍵盤：平板或手機連上掃碼槍後，系統鍵盤會被收起，所以數字輸入一律用這個（見 spec 8.1）
// 第一次按數字會取代原本的值（例如改價時直接打新價格），之後才接在後面
export default function NumericKeypad({ value, onChange, maxLength = 8 }: { value: string; onChange: (value: string) => void; maxLength?: number }) {
  const [touched, setTouched] = useState(false);

  const press = (key: string) => {
    if (key === 'clear') onChange('');
    else if (key === 'back') onChange(touched ? value.slice(0, -1) : '');
    else onChange(((touched ? value : '') + key).replace(/^0+(?=\d)/, '').slice(0, maxLength));
    setTouched(true);
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="數字鍵盤">
      {keys.map(key => (
        <button
          key={key}
          type="button"
          onClick={() => press(key)}
          aria-label={key === 'clear' ? '清除' : key === 'back' ? '刪除' : `數字 ${key}`}
          className={`flex h-14 items-center justify-center rounded-xl text-2xl font-bold active:bg-stone-300 ${key.length > 1 ? 'bg-stone-200 text-base' : 'bg-stone-100'}`}
        >
          {key === 'clear' ? '清除' : key === 'back' ? <Delete className="size-6" /> : key}
        </button>
      ))}
    </div>
  );
}
