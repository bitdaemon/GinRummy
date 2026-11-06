#!/usr/bin/env python3
"""Rebuild a Honest Gin deck from its revealed seed. Usage: python3 verify.py <seed>"""
import hashlib,sys
s=sys.argv[1]
d=[r+u for u in 'SHDC' for r in 'A23456789TJQK']
w=[];i=0
def nxt():
    global w,i
    if not w:
        h=hashlib.sha256(f"{s}:{i}".encode()).digest(); i+=1
        w=[int.from_bytes(h[k:k+4],'big') for k in range(0,32,4)]
    return w.pop(0)
for j in range(51,0,-1):
    n=j+1; lim=(2**32//n)*n
    while True:
        u=nxt()
        if u<lim: break
    r=u%n; d[j],d[r]=d[r],d[j]
print("lock:", hashlib.sha256(s.encode()).hexdigest())
print("deck:", " ".join(d))
