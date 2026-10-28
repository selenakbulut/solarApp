from io import BytesIO

import pandas as pd

from .comparison import daily_summary


def forecast_export(forecast, kind):
    hourly = pd.DataFrame(forecast['hourly'])
    if kind == 'csv':
        return hourly.to_csv(index=False).encode('utf-8-sig')
    output = BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        hourly.to_excel(writer, sheet_name='Saatlik Tahminler', index=False)
        pd.DataFrame(daily_summary(forecast['hourly'])).to_excel(writer, sheet_name='Günlük Özet', index=False)
        pd.DataFrame([forecast['run']]).to_excel(writer, sheet_name='Tahmin Parametreleri', index=False)
    return output.getvalue()
