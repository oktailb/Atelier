<?php
/**
 * Atelier by GallusTech - Pure-PHP Local QR Code SVG Generator (ISO/IEC 18004)
 * Generates scannable QR Code Model 2 SVGs (Versions 1-10, Error Correction Level L, Byte Mode)
 * completely offline so sensitive TOTP secrets NEVER leave the server to third-party APIs.
 */

namespace SimpleGallery\Kernel\Auth;

class QrCodeSvg {

    /**
     * ISO/IEC 18004 EC-Level L version specs:
     * [maxByteLen, totalCodewords, ecPerBlock, g1Blocks, g1DataCw, g2Blocks, g2DataCw, alignCoords]
     */
    private const VERSION_SPECS = [
        1  => [17,  26,  7,  1, 19,  0, 0,  []],
        2  => [32,  44,  10, 1, 34,  0, 0,  [6, 18]],
        3  => [53,  70,  15, 1, 55,  0, 0,  [6, 22]],
        4  => [78,  100, 20, 1, 80,  0, 0,  [6, 26]],
        5  => [106, 134, 26, 1, 108, 0, 0,  [6, 30]],
        6  => [134, 172, 18, 2, 68,  0, 0,  [6, 34]],
        7  => [154, 196, 20, 2, 78,  0, 0,  [6, 22, 38]],
        8  => [192, 242, 24, 2, 97,  0, 0,  [6, 24, 42]],
        9  => [230, 292, 30, 2, 116, 0, 0,  [6, 26, 46]],
        10 => [271, 346, 18, 2, 68,  2, 69, [6, 28, 50]]
    ];

    /** 18-bit BCH version information strings for Versions 7-10 */
    private const VERSION_INFO = [
        7  => 0x07C94,
        8  => 0x085BC,
        9  => 0x09A99,
        10 => 0x0A4D3
    ];

    /**
     * Generates a clean inline SVG QR code string for `$text`.
     */
    public static function render(string $text, int $quietZone = 4): string {
        $matrix = self::encodeMatrix($text);
        $n = count($matrix);
        $total = $n + 2 * $quietZone;

        $paths = [];
        for ($r = 0; $r < $n; $r++) {
            for ($c = 0; $c < $n; $c++) {
                if ($matrix[$r][$c] === 1) {
                    $x = $c + $quietZone;
                    $y = $r + $quietZone;
                    $paths[] = "M{$x},{$y}h1v1h-1z";
                }
            }
        }
        $d = implode('', $paths);
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' . $total . ' ' . $total . '" shape-rendering="crispEdges" role="img" aria-label="QR Code">'
            . '<rect width="' . $total . '" height="' . $total . '" fill="#ffffff" rx="2"/>'
            . '<path d="' . $d . '" fill="#0f172a"/>'
            . '</svg>';
    }

    /**
     * Builds the boolean 0/1 QR module matrix for `$text`.
     */
    public static function encodeMatrix(string $text): array {
        $bytes = array_values(unpack('C*', $text) ?: []);
        $len = count($bytes);

        $version = 0;
        foreach (self::VERSION_SPECS as $v => $spec) {
            if ($len <= $spec[0]) {
                $version = $v;
                break;
            }
        }
        if ($version === 0) {
            throw new \InvalidArgumentException('QR payload exceeds supported length (max 271 bytes).');
        }

        $spec = self::VERSION_SPECS[$version];
        [, , $ecPerBlock, $g1Blocks, $g1DataCw, $g2Blocks, $g2DataCw, $alignCoords] = $spec;
        $totalDataCw = $g1Blocks * $g1DataCw + $g2Blocks * $g2DataCw;

        // 1. Encode data bitstream (Byte mode indicator 0100 + length + data + terminator + padding)
        $bits = [];
        self::appendBits($bits, 0b0100, 4);
        self::appendBits($bits, $len, $version <= 9 ? 8 : 16);
        foreach ($bytes as $b) {
            self::appendBits($bits, $b, 8);
        }
        $capBits = $totalDataCw * 8;
        $termLen = min(4, $capBits - count($bits));
        self::appendBits($bits, 0, $termLen);
        while (count($bits) % 8 !== 0) {
            $bits[] = 0;
        }
        $padBytes = [0xEC, 0x11];
        $padIdx = 0;
        while (count($bits) < $capBits) {
            self::appendBits($bits, $padBytes[$padIdx % 2], 8);
            $padIdx++;
        }

        $dataCw = [];
        for ($i = 0; $i < count($bits); $i += 8) {
            $val = 0;
            for ($j = 0; $j < 8; $j++) {
                $val = ($val << 1) | $bits[$i + $j];
            }
            $dataCw[] = $val;
        }

        // 2. Split into RS blocks & interleave data + error correction codewords
        $blocksData = [];
        $blocksEc = [];
        $gen = self::rsGenerator($ecPerBlock);
        $offset = 0;
        for ($b = 0; $b < $g1Blocks; $b++) {
            $slice = array_slice($dataCw, $offset, $g1DataCw);
            $offset += $g1DataCw;
            $blocksData[] = $slice;
            $blocksEc[] = self::rsCompute($slice, $gen);
        }
        for ($b = 0; $b < $g2Blocks; $b++) {
            $slice = array_slice($dataCw, $offset, $g2DataCw);
            $offset += $g2DataCw;
            $blocksData[] = $slice;
            $blocksEc[] = self::rsCompute($slice, $gen);
        }

        $finalCw = [];
        $maxDataLen = max($g1DataCw, $g2DataCw);
        for ($i = 0; $i < $maxDataLen; $i++) {
            foreach ($blocksData as $bd) {
                if (isset($bd[$i])) {
                    $finalCw[] = $bd[$i];
                }
            }
        }
        for ($i = 0; $i < $ecPerBlock; $i++) {
            foreach ($blocksEc as $be) {
                if (isset($be[$i])) {
                    $finalCw[] = $be[$i];
                }
            }
        }

        $finalBits = [];
        foreach ($finalCw as $cw) {
            self::appendBits($finalBits, $cw, 8);
        }

        // 3. Allocate matrix & place function patterns
        $size = 17 + 4 * $version;
        $matrix = array_fill(0, $size, array_fill(0, $size, 0));
        $isFunc = array_fill(0, $size, array_fill(0, $size, false));

        self::placeFinder($matrix, $isFunc, 0, 0, $size);
        self::placeFinder($matrix, $isFunc, 0, $size - 7, $size);
        self::placeFinder($matrix, $isFunc, $size - 7, 0, $size);

        // Timing patterns
        for ($i = 8; $i < $size - 8; $i++) {
            $v = ($i % 2 === 0) ? 1 : 0;
            $matrix[6][$i] = $v;
            $isFunc[6][$i] = true;
            $matrix[$i][6] = $v;
            $isFunc[$i][6] = true;
        }

        // Alignment patterns
        $acLen = count($alignCoords);
        for ($i = 0; $i < $acLen; $i++) {
            for ($j = 0; $j < $acLen; $j++) {
                $r = $alignCoords[$i];
                $c = $alignCoords[$j];
                if (($i === 0 && $j === 0) || ($i === 0 && $j === $acLen - 1) || ($i === $acLen - 1 && $j === 0)) {
                    continue;
                }
                self::placeAlignment($matrix, $isFunc, $r, $c);
            }
        }

        // Dark module
        $matrix[$size - 8][8] = 1;
        $isFunc[$size - 8][8] = true;

        // Reserve format info areas
        for ($i = 0; $i <= 8; $i++) {
            if ($i !== 6) {
                $isFunc[8][$i] = true;
                $isFunc[$i][8] = true;
            }
        }
        for ($i = 0; $i < 8; $i++) {
            $isFunc[8][$size - 1 - $i] = true;
            if ($i < 7) {
                $isFunc[$size - 1 - $i][8] = true;
            }
        }

        // Place version info for versions 7+
        if ($version >= 7 && isset(self::VERSION_INFO[$version])) {
            $vBits = self::VERSION_INFO[$version];
            for ($i = 0; $i < 18; $i++) {
                $bit = ($vBits >> $i) & 1;
                $a = intdiv($i, 3);
                $b = $size - 11 + ($i % 3);
                $matrix[$a][$b] = $bit;
                $isFunc[$a][$b] = true;
                $matrix[$b][$a] = $bit;
                $isFunc[$b][$a] = true;
            }
        }

        // 4. Place data bits in upward/downward zigzag columns
        $bitIdx = 0;
        $bitCount = count($finalBits);
        $upward = true;
        for ($col = $size - 1; $col >= 1; $col -= 2) {
            if ($col === 6) {
                $col = 5;
            }
            for ($step = 0; $step < $size; $step++) {
                $row = $upward ? ($size - 1 - $step) : $step;
                for ($dc = 0; $dc < 2; $dc++) {
                    $c = $col - $dc;
                    if (!$isFunc[$row][$c]) {
                        $matrix[$row][$c] = ($bitIdx < $bitCount) ? $finalBits[$bitIdx++] : 0;
                    }
                }
            }
            $upward = !$upward;
        }

        // 5. Evaluate all 8 masks and pick the lowest penalty
        $bestMask = 0;
        $bestPenalty = PHP_INT_MAX;
        $bestMatrix = $matrix;

        for ($mask = 0; $mask < 8; $mask++) {
            $cand = $matrix;
            for ($r = 0; $r < $size; $r++) {
                for ($c = 0; $c < $size; $c++) {
                    if (!$isFunc[$r][$c] && self::maskBit($mask, $r, $c)) {
                        $cand[$r][$c] ^= 1;
                    }
                }
            }
            self::placeFormatInfo($cand, $size, $mask);
            $penalty = self::computePenalty($cand, $size);
            if ($penalty < $bestPenalty) {
                $bestPenalty = $penalty;
                $bestMask = $mask;
                $bestMatrix = $cand;
            }
        }

        return $bestMatrix;
    }

    private static function appendBits(array &$bits, int $val, int $len): void {
        for ($i = $len - 1; $i >= 0; $i--) {
            $bits[] = ($val >> $i) & 1;
        }
    }

    private static function gfMul(int $a, int $b): int {
        $p = 0;
        for ($i = 0; $i < 8; $i++) {
            if (($b & 1) !== 0) {
                $p ^= $a;
            }
            $hi = $a & 0x80;
            $a = ($a << 1) & 0xFF;
            if ($hi !== 0) {
                $a ^= 0x1D; // GF(256) primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
            }
            $b >>= 1;
        }
        return $p;
    }

    private static function rsGenerator(int $degree): array {
        $poly = [1];
        $root = 1;
        for ($i = 0; $i < $degree; $i++) {
            $next = array_fill(0, count($poly) + 1, 0);
            for ($j = 0; $j < count($poly); $j++) {
                $next[$j] ^= $poly[$j];
                $next[$j + 1] ^= self::gfMul($poly[$j], $root);
            }
            $poly = $next;
            $root = self::gfMul($root, 2);
        }
        return $poly;
    }

    private static function rsCompute(array $data, array $gen): array {
        $ecLen = count($gen) - 1;
        $rem = array_fill(0, $ecLen, 0);
        foreach ($data as $byte) {
            $factor = $byte ^ array_shift($rem);
            $rem[] = 0;
            if ($factor !== 0) {
                for ($i = 0; $i < $ecLen; $i++) {
                    $rem[$i] ^= self::gfMul($gen[$i + 1], $factor);
                }
            }
        }
        return $rem;
    }

    private static function placeFinder(array &$matrix, array &$isFunc, int $top, int $left, int $size): void {
        for ($dr = -1; $dr <= 7; $dr++) {
            for ($dc = -1; $dc <= 7; $dc++) {
                $r = $top + $dr;
                $c = $left + $dc;
                if ($r < 0 || $r >= $size || $c < 0 || $c >= $size) {
                    continue;
                }
                $inOuter = ($dr >= 0 && $dr <= 6 && $dc >= 0 && $dc <= 6) && ($dr === 0 || $dr === 6 || $dc === 0 || $dc === 6);
                $inInner = ($dr >= 2 && $dr <= 4 && $dc >= 2 && $dc <= 4);
                $matrix[$r][$c] = ($inOuter || $inInner) ? 1 : 0;
                $isFunc[$r][$c] = true;
            }
        }
    }

    private static function placeAlignment(array &$matrix, array &$isFunc, int $centerR, int $centerC): void {
        for ($dr = -2; $dr <= 2; $dr++) {
            for ($dc = -2; $dc <= 2; $dc++) {
                $d = max(abs($dr), abs($dc));
                $matrix[$centerR + $dr][$centerC + $dc] = ($d === 0 || $d === 2) ? 1 : 0;
                $isFunc[$centerR + $dr][$centerC + $dc] = true;
            }
        }
    }

    private static function maskBit(int $mask, int $r, int $c): bool {
        switch ($mask) {
            case 0: return (($r + $c) % 2) === 0;
            case 1: return ($r % 2) === 0;
            case 2: return ($c % 3) === 0;
            case 3: return (($r + $c) % 3) === 0;
            case 4: return ((intdiv($r, 2) + intdiv($c, 3)) % 2) === 0;
            case 5: return (($r * $c) % 2 + ($r * $c) % 3) === 0;
            case 6: return (((($r * $c) % 2) + (($r * $c) % 3)) % 2) === 0;
            case 7: return (((($r + $c) % 2) + (($r * $c) % 3)) % 2) === 0;
            default: return false;
        }
    }

    private static function placeFormatInfo(array &$matrix, int $size, int $mask): void {
        // EC Level L = 01 (2 bits) + mask (3 bits)
        $data = (0b01 << 3) | ($mask & 0b111);
        $rem = $data << 10;
        for ($i = 14; $i >= 10; $i--) {
            if (($rem & (1 << $i)) !== 0) {
                $rem ^= (0x537 << ($i - 10));
            }
        }
        $bits = (($data << 10) | $rem) ^ 0x5412;

        // Top-left horizontal & vertical
        for ($i = 0; $i <= 5; $i++) {
            $matrix[8][$i] = ($bits >> (14 - $i)) & 1;
        }
        $matrix[8][7] = ($bits >> 8) & 1;
        $matrix[8][8] = ($bits >> 7) & 1;
        $matrix[7][8] = ($bits >> 6) & 1;
        for ($i = 9; $i <= 14; $i++) {
            $matrix[14 - $i][8] = ($bits >> (14 - $i)) & 1;
        }

        // Bottom-left vertical & top-right horizontal
        for ($i = 0; $i < 7; $i++) {
            $matrix[$size - 1 - $i][8] = ($bits >> (14 - $i)) & 1;
        }
        for ($i = 0; $i < 8; $i++) {
            $matrix[8][$size - 8 + $i] = ($bits >> (7 - $i)) & 1;
        }
    }

    private static function computePenalty(array $m, int $size): int {
        $penalty = 0;
        // Rule 1: adjacent runs >= 5
        for ($r = 0; $r < $size; $r++) {
            $runColor = $m[$r][0];
            $runLen = 1;
            for ($c = 1; $c < $size; $c++) {
                if ($m[$r][$c] === $runColor) {
                    $runLen++;
                } else {
                    if ($runLen >= 5) $penalty += 3 + ($runLen - 5);
                    $runColor = $m[$r][$c];
                    $runLen = 1;
                }
            }
            if ($runLen >= 5) $penalty += 3 + ($runLen - 5);
        }
        for ($c = 0; $c < $size; $c++) {
            $runColor = $m[0][$c];
            $runLen = 1;
            for ($r = 1; $r < $size; $r++) {
                if ($m[$r][$c] === $runColor) {
                    $runLen++;
                } else {
                    if ($runLen >= 5) $penalty += 3 + ($runLen - 5);
                    $runColor = $m[$r][$c];
                    $runLen = 1;
                }
            }
            if ($runLen >= 5) $penalty += 3 + ($runLen - 5);
        }
        // Rule 2: 2x2 blocks
        for ($r = 0; $r < $size - 1; $r++) {
            for ($c = 0; $c < $size - 1; $c++) {
                $v = $m[$r][$c];
                if ($v === $m[$r][$c + 1] && $v === $m[$r + 1][$c] && $v === $m[$r + 1][$c + 1]) {
                    $penalty += 3;
                }
            }
        }
        return $penalty;
    }
}
