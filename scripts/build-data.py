#!/usr/bin/env python3
"""Offline preprocessing for Outbreak IA app.

Reads data/ pack (offline, no downloads) and writes compact JSON to public/data/.
- Regions: split big map units into admin-1, keep islands separate.
- Population: map-unit GHSL totals preserved exactly; admin-1 splits weighted by
  0.25deg GHSL cells, scaled to parent total.
- Travel: gravity weights calibrated to 13.4M daily air trips, plus land
  (synthetic, border-detected) and manual sea/air (estimated).
- Viruses/islands/meta passthrough.

Run: python3 scripts/build-data.py
"""
import csv, json, math, os, sys
from collections import defaultdict, Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
PUB = os.path.join(ROOT, "public", "data")
os.makedirs(PUB, exist_ok=True)

SOURCE_TOTAL = 7840952947
DAILY_AIR_TARGET = 4.89e9 / 365.0
ALPHA = 0.7
DELTA = 1.0
D0 = 100.0

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(min(1, math.sqrt(a)))

def bbox_of_coords(coords):
    xs = [c[0] for c in coords]; ys = [c[1] for c in coords]
    return (min(xs), min(ys), max(xs), max(ys))

def geom_bbox(geom):
    t = geom["type"]; cs = geom["coordinates"]
    boxes = []
    def track(pts):
        xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
        boxes.append((min(xs),min(ys),max(xs),max(ys)))
    if t=="Polygon":
        for ring in cs: track(ring)
    elif t=="MultiPolygon":
        for poly in cs:
            for ring in poly: track(ring)
    else: return None
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))

def point_in_ring(lon, lat, ring):
    inside=False
    n=len(ring)
    j=n-1
    for i in range(n):
        xi,yi=ring[i][0],ring[i][1]
        xj,yj=ring[j][0],ring[j][1]
        if ((yi>lat)!=(yj>lat)) and (lon < (xj-xi)*(lat-yi)/(yj-yi+1e-12)+xi):
            inside=not inside
        j=i
    return inside

def point_in_geom(lon, lat, geom):
    t=geom["type"]; cs=geom["coordinates"]
    if t=="Polygon":
        if not cs: return False
        if not point_in_ring(lon,lat,cs[0]): return False
        for hole in cs[1:]:
            if point_in_ring(lon,lat,hole): return False
        return True
    elif t=="MultiPolygon":
        for poly in cs:
            if not poly: continue
            if point_in_ring(lon,lat,poly[0]):
                hole=False
                for h in poly[1:]:
                    if point_in_ring(lon,lat,h): hole=True; break
                if not hole: return True
        return False
    return False

def planar_area(geom):
    # equirectangular approx, deg2 -> km2 via cos(lat)
    def ring_area(ring):
        s=0.0
        for i in range(len(ring)-1):
            s+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1]
        return abs(s)/2.0
    tot=0.0
    clat=0.0; cnt=0
    def scan(pts):
        nonlocal clat,cnt
        for p in pts: clat+=p[1]; cnt+=1
    t=geom["type"]; cs=geom["coordinates"]
    raw=0.0
    if t=="Polygon":
        for ri,ring in enumerate(cs):
            a=ring_area(ring)
            raw+= a if ri==0 else -a
            scan(ring)
    elif t=="MultiPolygon":
        for poly in cs:
            for ri,ring in enumerate(poly):
                a=ring_area(ring)
                raw+= a if ri==0 else -a
                scan(ring)
    if cnt: clat/=cnt
    km_per_deg=111.32
    return raw*(km_per_deg**2)*math.cos(math.radians(max(-89,min(89,clat))))

def geom_centroid(geom):
    # bbox centre fallback (robust for weird shapes)
    b=geom_bbox(geom)
    if not b: return (0.0,0.0)
    return ((b[0]+b[2])/2.0,(b[1]+b[3])/2.0)

def quantize_geom(geom, decimals=2, max_pts_per_ring=120):
    def proc_ring(ring):
        if len(ring)>max_pts_per_ring:
            step=max(1,len(ring)//max_pts_per_ring)
            ring=ring[::step]
            if ring[0]!=ring[-1]: ring=ring+[ring[0]]
        return [[round(float(x),decimals),round(float(y),decimals)] for x,y in ring]
    t=geom["type"]; cs=geom["coordinates"]
    if t=="Polygon":
        return {"type":"Polygon","coordinates":[proc_ring(r) for r in cs]}
    elif t=="MultiPolygon":
        return {"type":"MultiPolygon","coordinates":[[proc_ring(r) for r in poly] for poly in cs]}
    return geom

def load_csv(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))

print("Loading population by map unit...")
pop_rows=load_csv(os.path.join(DATA,"01_population","population_by_map_unit_GHSL2020.csv"))
pop_by_unit={}; area_by_unit={}; cent_by_unit={}; meta_by_unit={}
for r in pop_rows:
    u=r["unit_id"]
    pop_by_unit[u]=float(r["ghsl_pop_2020"]) if r["ghsl_pop_2020"] else 0.0
    area_by_unit[u]=float(r["area_km2"]) if r["area_km2"] else 0.0
    try: clat=float(r["centroid_lat"]); clon=float(r["centroid_lon"])
    except: clat,clon=0.0,0.0
    cent_by_unit[u]=(clon,clat)
    meta_by_unit[u]=r

print("Loading geojson...")
with open(os.path.join(DATA,"02_geography","map_units_simplified.geojson"), encoding='utf-8') as f:
    map_units=json.load(f)
with open(os.path.join(DATA,"02_geography","admin1_simplified.geojson"), encoding='utf-8') as f:
    admin1=json.load(f)

mu_geom={f["properties"]["unit_id"]:f["geometry"] for f in map_units["features"]}
mu_props={f["properties"]["unit_id"]:f["properties"] for f in map_units["features"]}

admin_by_parent=defaultdict(list)
for f in admin1["features"]:
    p=f["properties"]
    key=p.get("gu_a3") or p.get("adm0_a3")
    if key: admin_by_parent[key].append(f)

# split set
big=set()
for u,p in pop_by_unit.items():
    a=area_by_unit.get(u,0)
    if p>20_000_000 or a>1_000_000:
        big.add(u)
for m in ["CHN","IND","USA","BRA","RUS","IDN","NGA","PAK","CAN","AUS"]:
    big.add(m)
# always split SHN (Tristan / St Helena / Ascension)
big.add("SHN")
# drop big units with no admin children (keep as single)
big={u for u in big if len(admin_by_parent.get(u,[]))>0}
print(f"Split units: {len(big)}")

# remote islands
remote_rows=load_csv(os.path.join(DATA,"05_islands","remote_islands.csv"))
remote_units=set(r["map_unit_id"].strip() for r in remote_rows if r["map_unit_id"].strip())
print("Remote units:",sorted(remote_units))

# island parents heuristic
ISLAND_MANUAL={"JPN","PHL","IDN","IRL","ISL","LKA","TWN","CUB","DOM","HTI","JAM","BHS","FJI","MUS","SYC","COM","CPV","STP","ATG","BRB","DMA","GRD","KNA","LCA","VCT","ABW","CUW","CRI","PAN","ENG","SCT","WLS","NIR","IMN","JEY","GGY","NCL","GUM","MNP","ASM","WSM","TON","KIR","MHL","WLF","NFK","CCK","CXR","NSV","GRL","COK","TUV","NRU","TKL","PCN","NIU","SHN","FLK","PYF","NZL","HMD","SGS","BVT","IOT","MDV","BHR","MLT","CYP"}
island_parent=set(remote_units)|ISLAND_MANUAL
for u,props in mu_props.items():
    cont=(props.get("continent") or "")
    sub=(props.get("subregion") or "")
    if cont=="Oceania" and u!="AUS":
        island_parent.add(u)
    if sub in ("Caribbean","Polynesia","Micronesia","Melanesia"):
        # Caribbean mainland neighbours (e.g. Colombia/Venezuela subregion Caribbean?) keep mainland if big
        if area_by_unit.get(u,0)<200000:
            island_parent.add(u)

# Load 0.25deg cells for weighting splits
print("Loading 0.25deg cells...")
cells=load_csv(os.path.join(DATA,"01_population","GHS_POP_2020_cells_0p25deg.csv"))
# cells: lat_center, lon_center, population
print(f"cells: {len(cells)}")

# Build regions
regions=[]
# map admin1 code -> region index later
for u in sorted(pop_by_unit.keys()):
    p=pop_by_unit[u]; a=area_by_unit[u]
    props=mu_props.get(u,{})
    name=props.get("name") or meta_by_unit.get(u,{}).get("name") or u
    if u in big:
        children=admin_by_parent.get(u,[])
        # gather cells in parent bbox for weighting
        pg=mu_geom.get(u)
        pbbox=geom_bbox(pg) if pg else (-180,-90,180,90)
        # collect child bboxes
        child_boxes=[]
        for cf in children:
            try: b=geom_bbox(cf["geometry"])
            except: b=None
            child_boxes.append(b)
        # weight per child via cells
        weights=[0.0]*len(children)
        if pg:
            for c in cells:
                try: lon=float(c["lon_center"]); lat=float(c["lat_center"]); cp=float(c["population"])
                except: continue
                if not (pbbox[0]-0.01<=lon<=pbbox[2]+0.01 and pbbox[1]-0.01<=lat<=pbbox[3]+0.01):
                    continue
                # quick parent check? assume in parent if in bbox (approx); to be safe check point in parent for big? skip for speed, bbox only
                for idx,(cf,b) in enumerate(zip(children,child_boxes)):
                    if b is None: continue
                    if b[0]<=lon<=b[2] and b[1]<=lat<=b[3]:
                        if point_in_geom(lon,lat,cf["geometry"]):
                            weights[idx]+=cp
                            break
        totw=sum(weights)
        # planar areas for area split fallback
        pareas=[]
        for cf in children:
            try: pareas.append(max(0.0,planar_area(cf["geometry"])))
            except: pareas.append(0.0)
        totpa=sum(pareas) or 1.0
        for idx,cf in enumerate(children):
            pr=cf["properties"]
            code=pr.get("adm1_code") or f"{u}-{idx}"
            aname=pr.get("name") or code
            if totw>0:
                share=weights[idx]/totw
            else:
                share=pareas[idx]/totpa
            cpop=p*share
            carea=a*(pareas[idx]/totpa) if totpa>0 else 0.0
            clon,clat=geom_centroid(cf["geometry"])
            regions.append({
                "id":code,"name":f"{aname} ({name})","parentUnit":u,
                "population":cpop,"areaKm2":carea,
                "density":(cpop/carea if carea>0 else 0.0),
                "centroid":[clon,clat],
                "isIsland":(u in island_parent),
                "isRemote":(u in remote_units),
                "airports":[],
                "_geom":cf["geometry"],
                "admin1_code":code,
            })
        # special SHN manual pop override (tiny islands unresolved by 0.25deg grid)
        if u=="SHN":
            # find the three
            for rg in regions:
                if rg["parentUnit"]!="SHN": continue
                nm=rg["name"].lower()
                if "tristan" in nm: rg["population"]=250.0
                elif "ascension" in nm: rg["population"]=770.0
                elif "saint helena" in nm or "st helena" in nm or "helena" in nm:
                    rg["population"]=4400.0
            # rescale to parent total exactly
            shn=[r for r in regions if r["parentUnit"]=="SHN"]
            s=sum(r["population"] for r in shn)
            if s>0:
                for r in shn: r["population"]=r["population"]/s*p
            for r in shn:
                r["density"]=r["population"]/r["areaKm2"] if r["areaKm2"]>0 else 0
    else:
        clon,clat=cent_by_unit.get(u,(0.0,0.0))
        g=mu_geom.get(u)
        if g:
            try: clon2,clat2=geom_centroid(g)
            except: clon2,clat2=clon,clat
            # prefer CSV centroid (population-weighted approx) if available and nonzero
            if clon==0.0 and clat==0.0:
                clon,clat=clon2,clat2
        regions.append({
            "id":u,"name":name,"parentUnit":u,
            "population":p,"areaKm2":a,
            "density":(p/a if a>0 else 0.0),
            "centroid":[float(clon),float(clat)],
            "isIsland":(u in island_parent),
            "isRemote":(u in remote_units),
            "airports":[],
            "_geom":g,
            "admin1_code":None,
        })

print(f"regions built: {len(regions)}")
# population assertion
tot=sum(r["population"] for r in regions)
# map-unit assigned total
assigned=sum(pop_by_unit.values())
print(f"region total {tot:.0f} assigned {assigned:.0f} source {SOURCE_TOTAL}")
dropped=SOURCE_TOTAL-tot
print(f"dropped (unassigned coastal): {dropped:.0f}")
assert abs(tot-assigned)<1.0, f"regions {tot} != assigned {assigned}"
assert len(regions)>=800 and len(regions)<=2600, f"region count {len(regions)} outside 800-2500 (allowing SHN extra)"

# Airports -> regions
print("Loading airports...")
ap_rows=load_csv(os.path.join(DATA,"03_travel","airports_with_scheduled_routes.csv"))
# Build lookup unit->region indices
unit_to_indices=defaultdict(list)
for i,r in enumerate(regions):
    unit_to_indices[r["parentUnit"]].append(i)
# For split units, need point-in-polygon assignment
iata_to_region={}
for ap in ap_rows:
    iata=(ap.get("iata") or "").strip()
    if not iata or iata=="-": continue
    try: alat=float(ap["lat"]); alon=float(ap["lon"])
    except: continue
    unit=(ap.get("unit_id") or "").strip()
    cand=unit_to_indices.get(unit,[])
    if len(cand)==1:
        idx=cand[0]
    elif len(cand)>1:
        found=None
        for ci in cand:
            g=regions[ci].get("_geom")
            if g and point_in_geom(alon,alat,g):
                found=ci; break
        if found is None:
            # nearest centroid fallback
            best=None; bd=1e18
            for ci in cand:
                cx,cy=regions[ci]["centroid"][0],regions[ci]["centroid"][1]
                d=(cx-alon)**2+(cy-alat)**2
                if d<bd: bd=d; best=ci
            found=best
        idx=found
    else:
        # unit not in our list (e.g. unknown) -> nearest region centroid within 30km? skip
        continue
    iata_to_region[iata]=idx
    if iata not in regions[idx]["airports"]:
        regions[idx]["airports"].append(iata)

print(f"airports mapped: {len(iata_to_region)}")

# Air edges: aggregate airport_route_edges to region pairs
print("Loading route edges...")
re_rows=load_csv(os.path.join(DATA,"03_travel","airport_route_edges.csv"))
pair_agg={}  # (s,d)->[routes, airline_pairs, min_dist]
for e in re_rows:
    si=(e.get("src_iata") or "").strip(); di=(e.get("dst_iata") or "").strip()
    if si not in iata_to_region or di not in iata_to_region: continue
    s=iata_to_region[si]; d=iata_to_region[di]
    if s==d: continue
    try: al=float(e.get("airlines") or 1)
    except: al=1.0
    try: dist=float(e.get("distance_km") or 0)
    except: dist=0.0
    k=(s,d)
    if k not in pair_agg: pair_agg[k]=[0,0.0,dist if dist>0 else 1e9]
    pair_agg[k][0]+=1
    pair_agg[k][1]+=al
    if dist>0 and dist<pair_agg[k][2]: pair_agg[k][2]=dist

print(f"region air pairs (directed): {len(pair_agg)}")
# gravity raw
raw={}
for (s,d),(routes,apairs,mind) in pair_agg.items():
    ps=max(1.0,regions[s]["population"]); pd=max(1.0,regions[d]["population"])
    if mind>=1e8 or mind<=0:
        # centroid distance
        slon,slat=regions[s]["centroid"]; dlon,dlat=regions[d]["centroid"]
        mind=haversine_km(slat,slon,dlat,dlon)
        mind=max(10.0,mind)
    r=apairs*(ps**ALPHA)*(pd**ALPHA)/((mind+D0)**DELTA)
    raw[(s,d)]=r
S=sum(raw.values())
c=DAILY_AIR_TARGET/S if S>0 else 0
print(f"air raw sum {S:.3e} c={c:.3e} calibrated total {S*c:.3e} target {DAILY_AIR_TARGET:.3e}")

air_edges=[]
for (s,d),r in raw.items():
    w=r*c
    if w<=0: continue
    air_edges.append((s,d,w,pair_agg[(s,d)][1],pair_agg[(s,d)][2]))

# Land edges via border detection (bbox overlap + vertex proximity)
print("Detecting land neighbours...")
# precompute bboxes and sample vertices
bboxes=[]; verts=[]
for r in regions:
    g=r.get("_geom")
    if g is None:
        bboxes.append(None); verts.append([]); continue
    try: b=geom_bbox(g)
    except: b=None
    bboxes.append(b)
    # collect vertices (decimated)
    pts=[]
    try:
        t=g["type"]; cs=g["coordinates"]
        def add_ring(ring):
            step=max(1,len(ring)//40)
            for p in ring[::step]:
                pts.append((float(p[0]),float(p[1])))
        if t=="Polygon":
            for ring in cs: add_ring(ring)
        elif t=="MultiPolygon":
            for poly in cs:
                for ring in poly: add_ring(ring)
    except: pass
    verts.append(pts)

land_pairs=set()
n=len(regions)
THRESH=0.25  # degrees ~27km
for i in range(n):
    bi=bboxes[i]
    if bi is None: continue
    for j in range(i+1,n):
        bj=bboxes[j]
        if bj is None: continue
        # bbox overlap expanded
        if not (bi[0]-0.6<=bj[2] and bj[0]-0.6<=bi[2] and bi[1]-0.6<=bj[3] and bj[1]-0.6<=bi[3]):
            continue
        # vertex proximity
        vi=verts[i]; vj=verts[j]
        if not vi or not vj: continue
        # quick: if both large, sample subset
        found=False
        # brute but with early exit; limit sizes
        A=vi if len(vi)<=60 else vi[::max(1,len(vi)//60)]
        B=vj if len(vj)<=60 else vj[::max(1,len(vj)//60)]
        for ax,ay in A:
            for bx,by in B:
                if abs(ax-bx)<THRESH and abs(ay-by)<THRESH:
                    # squared dist
                    if (ax-bx)**2+(ay-by)**2 < THRESH*THRESH:
                        found=True; break
            if found: break
        if found:
            land_pairs.add((i,j)); land_pairs.add((j,i))

print(f"land pairs: {len(land_pairs)//2} undirected")
land_edges=[]
for (s,d) in land_pairs:
    if s>=d: continue  # add both directions below
    ps=max(1.0,regions[s]["population"]); pd=max(1.0,regions[d]["population"])
    slon,slat=regions[s]["centroid"]; dlon,dlat=regions[d]["centroid"]
    dist=max(10.0,haversine_km(slat,slon,dlat,dlon))
    r=1.0*(ps**ALPHA)*(pd**ALPHA)/((dist+D0)**DELTA)
    w=r*c  # same scale as air (documented assumption)
    # both directions
    land_edges.append((s,d,w,1.0,dist))
    land_edges.append((d,s,w,1.0,dist))

# Manual estimated links
print("Adding manual links...")
def find_region(pred, label):
    for i,r in enumerate(regions):
        if pred(r): return i
    print(f"WARN manual link region not found: {label}")
    return None

def find_by_id(uid):
    for i,r in enumerate(regions):
        if r["id"]==uid: return i
    return None

# helpers: find Gauteng (Johannesburg) in ZAF, Auckland region = NZL single
idx_TKL=find_by_id("TKL")
idx_WSM=find_by_id("WSM")
idx_PCN=find_by_id("PCN")
idx_NIU=find_by_id("NIU")
idx_NZL=find_by_id("NZL")
idx_PYF=find_by_id("PYF")
# SHN children
idx_tristan=idx_sthelena=idx_asc=None
for i,r in enumerate(regions):
    if r["parentUnit"]=="SHN":
        nm=r["name"].lower()
        if "tristan" in nm: idx_tristan=i
        elif "ascension" in nm: idx_asc=i
        elif "helena" in nm: idx_sthelena=i
# ZAF Gauteng
idx_gauteng=None
for i,r in enumerate(regions):
    if r["parentUnit"]=="ZAF" and "gauteng" in r["name"].lower():
        idx_gauteng=i; break
if idx_gauteng is None:
    # fallback most populous ZAF
    cands=[(r["population"],i) for i,r in enumerate(regions) if r["parentUnit"]=="ZAF"]
    if cands: idx_gauteng=max(cands)[1]

manual=[]  # (s,d,w,note)
def add_manual(a,b,w_each,note):
    if a is None or b is None: print(f"skip manual {note}"); return
    manual.append((a,b,w_each,note)); manual.append((b,a,w_each,note))

add_manual(idx_TKL,idx_WSM,26*100/365,"Tokelau-Samoa ferry ~fortnightly (estimated)")
add_manual(idx_PCN,idx_PYF,4*50/365,"Pitcairn-French Polynesia supply ship ~3-monthly (estimated)")
add_manual(idx_PCN,idx_NZL,4*50/365,"Pitcairn-New Zealand supply ship link (estimated)")
add_manual(idx_tristan,idx_gauteng,9*100/365,"Tristan da Cunha-South Africa ship 8-10/yr (estimated)")
add_manual(idx_sthelena,idx_gauteng,52*150/365,"Saint Helena-Johannesburg weekly flight (estimated, missing in OpenFlights)")
add_manual(idx_NIU,idx_NZL,78*120/365,"Niue-Auckland 1-2 flights/week (estimated, missing in OpenFlights)")

print(f"manual directed edges: {len(manual)}")

# Combine edges: index regions 0..n-1, ids
# Deduplicate: if same (s,d) has air+land, keep both? Sum? Keep separate entries summed.
edge_map={}  # (s,d)->[w, type, airline_pairs, dist]
# type priority: observed(0) + synthetic(1) sum; estimated(2) sum
for s,d,w,ap,dist in air_edges:
    k=(s,d)
    if k in edge_map: edge_map[k][0]+=w; edge_map[k][2]+=ap
    else: edge_map[k]=[w,0,ap,dist]
for s,d,w,ap,dist in land_edges:
    k=(s,d)
    if k in edge_map: edge_map[k][0]+=w  # keep type observed if already observed? mark mixed as observed? keep min type
    else: edge_map[k]=[w,1,ap,dist]
for s,d,w,note in manual:
    k=(s,d)
    if k in edge_map: edge_map[k][0]+=w
    else: edge_map[k]=[w,2,0,0]

edges_out=[]
for (s,d),(w,t,ap,dist) in edge_map.items():
    if w<=1e-9: continue
    edges_out.append({"s":s,"d":d,"w":w,"t":t,"a":round(float(ap),1) if t==0 else None,"dkm":round(float(dist),1) if dist else None})

print(f"total directed edges: {len(edges_out)}")
# in/out weights
inW=[0.0]*len(regions); outW=[0.0]*len(regions)
for e in edges_out:
    outW[e["s"]]+=e["w"]; inW[e["d"]]+=e["w"]

# finalize regions output (quantize polygons, point markers for tiny)
out_regions=[]
for i,r in enumerate(regions):
    g=r.get("_geom")
    is_point=False
    geom_out=None
    if g is None:
        is_point=True
    else:
        # tiny -> point marker
        if r["areaKm2"]<150 or r["population"]<3000:
            # keep point if polygon very small to save size, unless remote island needing shape? still point is fine
            # but keep polygon for slightly bigger? threshold: area<50km2 -> point
            if r["areaKm2"]<150:
                is_point=True
        if not is_point:
            try:
                q=quantize_geom(g,decimals=2,max_pts_per_ring=150)
                geom_out=q
            except:
                is_point=True
    out_regions.append({
        "id":r["id"],"name":r["name"],"parentUnit":r["parentUnit"],
        "population":round(float(r["population"]),1),
        "areaKm2":round(float(r["areaKm2"]),2),
        "density":round(float(r["density"]),3),
        "centroid":[round(float(r["centroid"][0]),4),round(float(r["centroid"][1]),4)],
        "isIsland":bool(r["isIsland"]),"isRemote":bool(r["isRemote"]),
        "airports":r["airports"],
        "inW":round(float(inW[i]),3),"outW":round(float(outW[i]),3),
        "point":is_point,
        "geom":geom_out,
    })

# sort? keep build order; also build id->index
id_to_idx={r["id"]:i for i,r in enumerate(out_regions)}

# viruses passthrough
with open(os.path.join(DATA,"04_viruses","virus_presets.json"), encoding='utf-8') as f:
    vp=json.load(f)

# islands
hist_rows=load_csv(os.path.join(DATA,"05_islands","historical_island_outbreaks.csv"))

with open(os.path.join(PUB,"regions.json"),"w",encoding='utf-8') as f:
    json.dump({"count":len(out_regions),"regions":out_regions},f,separators=(",",":"))
with open(os.path.join(PUB,"edges.json"),"w",encoding='utf-8') as f:
    json.dump({"count":len(edges_out),"edges":edges_out},f,separators=(",",":"))
with open(os.path.join(PUB,"viruses.json"),"w",encoding='utf-8') as f:
    json.dump(vp,f,indent=1)
with open(os.path.join(PUB,"islands.json"),"w",encoding='utf-8') as f:
    json.dump({"remote":remote_rows,"history":hist_rows},f,indent=1)

# meta
air_total=sum(e["w"] for e in edges_out if e["t"]==0)
land_total=sum(e["w"] for e in edges_out if e["t"]==1)
sea_total=sum(e["w"] for e in edges_out if e["t"]==2)
meta={
  "generated":"2026-10-06 (data pack) / preprocessed offline",
  "source_total":SOURCE_TOTAL,
  "region_total":round(tot,1),
  "assigned_total":round(assigned,1),
  "dropped":round(dropped,1),
  "dropped_note":"529 coastal cells (141,347 people) more than 50 km from any polygon are unassigned (per data/README).",
  "num_regions":len(out_regions),
  "num_edges":len(edges_out),
  "num_air_edges":sum(1 for e in edges_out if e["t"]==0),
  "num_land_edges":sum(1 for e in edges_out if e["t"]==1),
  "num_estimated_edges":sum(1 for e in edges_out if e["t"]==2),
  "daily_air_trips_m1":air_total,
  "daily_land_trips_m1":land_total,
  "daily_estimated_trips_m1":sea_total,
  "calibration":{"method":"W_ij = c * A_ij * P_i^0.7 * P_j^0.7 / (d_ij+100)^1.0; c scaled so total daily air trips at m=1 ~= 4.89e9/365 ~= 13.4M","c":c,"alpha":ALPHA,"delta":DELTA,"d0":D0,"target":DAILY_AIR_TARGET},
  "datasets":[
    {"name":"GHS-POP R2023A epoch 2020","version":"R2023A","year":2020,"resolution":"30 arc-sec aggregated to 0.1/0.25/1 deg","licence":"Free reuse with attribution (JRC)","total":SOURCE_TOTAL},
    {"name":"Natural Earth Admin-0 map units + Admin-1 states/provinces","version":"1:10m","year":2024,"licence":"Public domain"},
    {"name":"OpenFlights airports/routes (~2014 snapshot, no passenger volumes)","year":2014,"licence":"ODbL (attribute + share-alike)"},
    {"name":"OurAirports full list","licence":"Public domain"},
    {"name":"IATA passenger totals (2019 4.54bn, 2020 1.78bn, 2023 4.44bn, 2024 4.89bn)","year":2024},
    {"name":"World Bank WDI population/density/air passengers","licence":"CC BY 4.0","note":"cross-check only, never mixed into model"},
    {"name":"Virus presets (15) + island lists","note":"rows tagged [TEXTBOOK-UNVERIFIED] need primary citation"}
  ],
  "edge_types":{"0":"observed air route structure (OpenFlights)","1":"synthetic land neighbours (border-detected, same gravity, same c)","2":"estimated manual sea/air links (frequency x passengers / 365)"},
  "regions_note":"Split units over 20M people or 1M km2 (+ SHN special) into admin-1; others single region per map unit. Admin-1 pops weighted by 0.25deg GHSL cells scaled to parent 0.1deg-based total. Areas split by planar polygon share scaled to parent area.",
  "years_note":"Population 2020, route structure ~2014, passenger calibration 2024, manual links estimates."
}
with open(os.path.join(PUB,"meta.json"),"w",encoding='utf-8') as f:
    json.dump(meta,f,indent=1)

print("Wrote public/data/: regions, edges, viruses, islands, meta")
print(f"regions={len(out_regions)} edges={len(edges_out)} dropped={dropped:.0f}")
# asserts
assert abs(sum(r["population"] for r in out_regions)-assigned)<2.0
print("OK")
