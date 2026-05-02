const r = await fetch("https://www.odata.org.il/datastore/dump/12ff06bf-e672-4fd9-ae63-b94dd8b71d69?bom=True"); const t = await r.text(); console.log(t.slice(0, 500));
