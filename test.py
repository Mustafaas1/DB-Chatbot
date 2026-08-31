from pybot.db import run_select
print(run_select("SELECT TOP (200) Asama AS [Asama], COUNT(*) AS [Bilet Sayisi] FROM dbo.TicketRecords WHERE IsDeleted = 0 AND Asama != 'Tamamlandı' GROUP BY Asama"))
