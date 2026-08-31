from pybot.db import run_select
r = run_select("SELECT TOP (200) Asama AS [Aama], COUNT(*) AS [Bilet Says] FROM dbo.TicketRecords WHERE IsDeleted = 0 AND Asama != 'Tamamland' GROUP BY Asama")
print(r.duration_ms, r.rows)
